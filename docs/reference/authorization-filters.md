---
id: authorization-filters
title: Authorization Filters
sidebar_label: Authorization Filters
---

# Authorization Filters

`IkeMtz.NRSRx.Core.Authorization` provides **action filter attributes** for claim-based
permission checks. They complement ASP.NET's role-based `[Authorize(Roles=...)]` with
fine-grained, claim-level access control.

## PermissionsFilterAttribute

Checks the user's `permissions` or `scope` claims for one of the allowed values. Returns
`401 UnauthorizedObjectResult` if none match.

```csharp
using IkeMtz.NRSRx.Core.Authorization;

// Any action on this controller requires "courses:read".
[Authorize]
[PermissionsFilter(new[] { "courses:read" })]
public class CoursesController : ControllerBase
{
  // Requires "courses:write" in addition to authentication.
  [HttpPost]
  [PermissionsFilter(new[] { "courses:write" })]
  public async Task<ActionResult> Post([FromBody] CourseUpsertRequest req) { ... }

  // Either "courses:delete" or "admin:all" is sufficient.
  [HttpDelete]
  [PermissionsFilter(new[] { "courses:delete", "admin:all" })]
  public async Task<ActionResult> Delete([FromQuery] Guid id) { ... }
}
```

### How the check works

1. The filter reads all claims whose type matches `PermissionClaimType` (default: `"permissions"`).
2. Each claim value is compared **whole** against `AllowedPermissions` (case-insensitive) —
   identity providers like Auth0 emit one `permissions` claim per permission, so no
   splitting is needed. If any match, access is granted.
3. If `AllowScopes` is `true` (default), it also checks `ScopeClaimType` (default: `"scope"`),
   splitting each value by space per the OAuth2 convention.
4. If no match is found, it returns a `401` with a message listing the required permissions.

### Constructor parameters

```csharp
public PermissionsFilterAttribute(
    string[] allowedPermissions,
    bool   allowScopes            = true,
    string permissionClaimType    = "permissions",
    char   permissionClaimSeparator = ',',
    string scopeClaimType         = "scope")
```

| Parameter | Default | Purpose |
| --- | --- | --- |
| `allowedPermissions` | (required) | One or more permission values; any match grants access. |
| `allowScopes` | `true` | Also check the `scope` claim as a fallback. |
| `permissionClaimType` | `"permissions"` | The claim type that contains permissions. |
| `permissionClaimSeparator` | `','` | Accepted and stored on the attribute, but **not used** by the current matching logic — `permissions` claim values are matched whole, never split. |
| `scopeClaimType` | `"scope"` | The claim type used for OAuth scopes. |

### Disabling scope fallback

```csharp
// Only the "permissions" claim is checked; scopes are ignored.
[PermissionsFilter(new[] { "courses:write" }, allowScopes: false)]
```

### Custom claim types

```csharp
// Your identity server emits permissions in a "my_perms" claim.
[PermissionsFilter(new[] { "write" }, permissionClaimType: "my_perms")]
```

---

## ExpandPermissionsFilterAttribute

Silently **strips an `$expand` clause** from an OData query when the user lacks the
required permissions. The request still succeeds — the user just doesn't get the expanded
navigation property. Use this instead of `PermissionsFilterAttribute` when you want
graceful degradation rather than a hard 401.

```csharp
[HttpGet]
[EnableQuery]
// Users without "grades:read" get Students without the Grades navigation.
[ExpandPermissionsFilter(new[] { "grades:read" }, expandClause: "Grades")]
public IQueryable<Student> Get() => _db.Students.AsNoTracking();
```

If the user has `grades:read`, the query runs as-is. If they don't, the filter removes
`Grades` from the `$expand` value in the query string before the action runs. Other expand
clauses in the same `$expand` are preserved.

### Constructor parameters

```csharp
public ExpandPermissionsFilterAttribute(
    string[] allowedPermissions,
    string   expandClause,
    bool     allowScopes            = true,
    string   permissionClaimType    = "permissions",
    char     permissionClaimSeparator = ',',
    string   scopeClaimType         = "scope")
```

The first two parameters are required:

| Parameter | Purpose |
| --- | --- |
| `allowedPermissions` | Permissions that grant access to the expand clause. |
| `expandClause` | The exact navigation name to strip if the user lacks permissions (e.g., `"Grades"`). |

---

## BaseActionFilterAttribute

Both filter attributes extend `BaseActionFilterAttribute`, which you can subclass to build
custom permission logic:

```csharp
public sealed class RequireAdminOrOwnerAttribute : BaseActionFilterAttribute
{
  public RequireAdminOrOwnerAttribute()
    : base(allowedPermissions: new[] { "admin:all" }) { }

  public override void OnActionExecuting(ActionExecutingContext context)
  {
    if (HasPermission(context)) return; // admin passes

    // Fallback: also allow if the record belongs to the current user.
    var userId = context.HttpContext.User.FindFirst("sub")?.Value;
    var routeId = context.RouteData.Values["id"]?.ToString();
    if (userId == routeId) return;

    context.Result = new UnauthorizedObjectResult("Admin or owner required.");
  }
}
```

`BaseActionFilterAttribute` exposes:

| Member | Purpose |
| --- | --- |
| `HasPermission(context)` | Returns `true` if the user has any of the allowed permissions. |
| `HasMatchingPermissionClaim(type, claims, separator)` | Lower-level check on a specific claim type. |
| `AllowedPermissions` | The permissions array passed in the constructor. |
| `PermissionClaimType` | Claim type to check (default `"permissions"`). |
| `ScopeClaimType` | Scope claim type (default `"scope"`). |
| `AllowScopes` | Whether scope fallback is enabled. |

---

## Testing permission filters

In unigration tests, inject custom permissions into the test token using
`GenerateTestToken`:

```csharp
var token = GenerateTestToken(claims =>
{
  // One claim per permission — values are matched whole, not comma-split.
  claims.Add(new Claim("permissions", "courses:write"));
  claims.Add(new Claim("permissions", "courses:read"));
  // Alternatively, the "scope" claim IS space-separated:
  // claims.Add(new Claim("scope", "courses:write courses:read"));
});
GenerateAuthHeader(client, token);
```

To test the 401 path, call the endpoint without the required permission claim:

```csharp
// Token with no permissions claim — should return 401.
GenerateAuthHeader(client, GenerateTestToken());
var response = await client.PostAsJsonAsync("api/v1/Courses.json", request);
Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
```
