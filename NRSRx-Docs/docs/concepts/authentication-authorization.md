---
id: authentication-authorization
title: Authentication & Authorization
sidebar_label: Auth & Authorization
---

# Authentication & Authorization

NRSRx services are secure by intent. Authentication is wired into the pipeline, and the
framework's guidelines recommend that *every* endpoint require authentication.

## Authentication: JWT bearer tokens

NRSRx validates **JWT bearer tokens** issued by OAuth2 and OpenID Connect identity
providers. Setup happens in two steps during `ConfigureServices`:

```csharp
SetupAuthentication(SetupJwtAuthSchema(services));
```

### SetupJwtAuthSchema

Registers the JWT bearer scheme as both the default authenticate and challenge scheme:

```csharp
services.AddAuthentication(options =>
{
  options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
  options.DefaultChallengeScheme   = JwtBearerDefaults.AuthenticationScheme;
});
```

### SetupAuthentication

Configures token validation against your identity provider:

```csharp
builder.AddJwtBearer(options =>
{
  options.Authority = Configuration.GetValue<string>("IdentityProvider");
  options.TokenValidationParameters = new TokenValidationParameters
  {
    ValidateIssuer = true,
    ValidateIssuerSigningKey = true,
    NameClaimType = JwtNameClaimMapping,    // default: "sub"
    ValidAudiences = GetIdentityAudiences(), // from "IdentityAudiences"
    RoleClaimType = JwtRoleClaimMapping,    // default: "role"
  };
});
```

Two configuration keys drive this:

| Key | Meaning |
| --- | --- |
| `IdentityProvider` | The OIDC authority. NRSRx fetches its `.well-known/openid-configuration` to discover signing keys. |
| `IdentityAudiences` | Comma-separated list of audiences the token must target. |

### Claim mappings

The base class clears the default inbound claim-type maps (so claims aren't renamed) and
exposes two overridable properties:

| Property | Default | Purpose |
| --- | --- | --- |
| `JwtNameClaimMapping` | `sub` | Which claim becomes `User.Identity.Name`. |
| `JwtRoleClaimMapping` | `role` | Which claim supplies roles for `[Authorize(Roles=...)]`. |

Override them if your provider uses different claim names:

```csharp
public override string JwtNameClaimMapping => "preferred_username";
public override string JwtRoleClaimMapping => "roles";
```

:::warning Misconfigured claim mapping
If `JwtNameClaimMapping` is set to a claim that is absent from the token,
`AuditableDbContext` will throw `AuditableInvalidUserException` when it tries to stamp
`CreatedBy`. This is a deliberate fail-fast to catch misconfigured claim mappings early.
:::

## Authorization: role-based

Authorization uses ASP.NET's standard attributes. Because the role claim is mapped during
setup, `[Authorize(Roles = "...")]` just works:

```csharp
[Authorize]                              // any authenticated user
public class CoursesController : ControllerBase { }

[Authorize(Roles = "Administrator")]     // only the Administrator role
public class AdminController : ControllerBase { }
```

The framework's guidance is explicit:

> Each microservice endpoint should require authentication. In addition, varying levels of
> authorization should be implemented to match those specified by the data owner.

## Claim-based permission filters

`IkeMtz.NRSRx.Core.Authorization` provides **action filter attributes** for fine-grained,
claim-based permission checks that go beyond role membership.

### PermissionsFilterAttribute

Checks the user's `permissions` claim (comma-separated values) or `scope` claim
(space-separated values) for one of the allowed values. Returns `401 Unauthorized` if none
match.

```csharp
// Allow users with the "courses:write" permission or scope.
[HttpPost]
[PermissionsFilter(new[] { "courses:write" })]
public async Task<ActionResult> Post([FromBody] CourseUpsertRequest request)
{
  // ...
}

// Allow users with either of two permissions.
[HttpDelete]
[PermissionsFilter(new[] { "courses:delete", "admin:all" })]
public async Task<ActionResult> Delete([FromQuery] Guid id)
{
  // ...
}
```

The filter checks `permissions` claims first, then `scope` claims. To disable scope
fallback, pass `allowScopes: false`:

```csharp
[PermissionsFilter(new[] { "courses:write" }, allowScopes: false)]
```

To use a non-standard claim type, pass it explicitly:

```csharp
[PermissionsFilter(new[] { "write" }, permissionClaimType: "my_permissions")]
```

### ExpandPermissionsFilterAttribute

Silently **strips an `$expand` clause** from OData queries when the user lacks the
required permissions. Use it to allow restricted navigations without returning 401 —
the user gets the base entity, just without the expanded navigation.

```csharp
[HttpGet]
[EnableQuery]
// Users without "grades:read" won't have $expand=Grades applied;
// the rest of the query still runs.
[ExpandPermissionsFilter(new[] { "grades:read" }, expandClause: "Grades")]
public IQueryable<Student> Get() => _db.Students.AsNoTracking();
```

Both attributes inherit from `BaseActionFilterAttribute`, which you can subclass to build
your own permission filter logic.

:::info Package
`PermissionsFilterAttribute` and `ExpandPermissionsFilterAttribute` live in the
`IkeMtz.NRSRx.Core.Authorization` NuGet package, which must be referenced separately
from the web flavor packages. See [Authorization Filters](../reference/authorization-filters.md)
for the full reference.
:::

## Who is the current user? ICurrentUserProvider

NRSRx registers an HTTP-aware implementation, `HttpUserProvider`, for the
`ICurrentUserProvider` interface:

```csharp
public interface ICurrentUserProvider
{
  string? GetCurrentUserId(string? defaultValue = null);
}
```

This is how `AuditableDbContext` knows *who* created or updated a record — it asks the
current-user provider for the user id and stamps it onto `CreatedBy` and `UpdatedBy`. In
non-HTTP contexts such as jobs, register `SystemUserProvider` instead:

```csharp
public override void SetupUserProvider(IServiceCollection services) =>
  services.AddScoped<ICurrentUserProvider, SystemUserProvider>();
```

`SystemUserProvider` (from `IkeMtz.NRSRx.Core.EntityFramework`) returns a fixed
`"NRSRx System User"` string. You can change the string by setting
`SystemUserProvider.SystemUserId` before registration.

You can also replace the user provider for the entire web service by overriding
`SetupCurrentUserProvider` in your `Startup`:

```csharp
public override IServiceCollection SetupCurrentUserProvider(IServiceCollection services) =>
  services.AddScoped<ICurrentUserProvider, MyCustomUserProvider>();
```

## Multi-tenancy

For tenant-scoped services, the `CoreTenantFilterAttribute` request filter works with the
`ITentantable` model interface to constrain data to the caller's tenant. See
[Multi-Tenancy](./multi-tenancy.md).

## Running without auth (local experimentation)

Authentication is a `virtual` method, so for a throwaway local spike you can override it
to do nothing. Do **not** do this in any shared or production environment:

```csharp
public override void SetupAuthentication(AuthenticationBuilder builder) { /* no-op */ }
```

## Swagger and auth

The Swagger UI is configured as an OIDC client (`SwaggerClientId`, `SwaggerClientSecret`,
`SwaggerAppName`, with PKCE enabled) so you can obtain a token and call secured endpoints
right from the docs page. See [Swagger & OpenAPI](./swagger.md).
