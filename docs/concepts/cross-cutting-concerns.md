---
id: cross-cutting-concerns
title: Cross-Cutting Concerns
sidebar_label: Cross-Cutting Concerns
---

# Cross-Cutting Concerns

"Cross-cutting concerns" are the responsibilities that *every* microservice has, no matter
what its domain is. They cut across features: every endpoint needs auth, every request
might be logged, every write should be audited. NRSRx exists mainly to handle these so
your team doesn't reinvent them per service.

This page is a map. Each concern links to a deeper page.

## The concerns NRSRx handles

### Externalized configuration
Configuration is layered from `appsettings.json`, **User Secrets** (great for local dev),
and **environment variables** (great for containers and cloud). Strongly-typed access is
provided through `AppSettings`. See [Configuration](./configuration.md).

### Authentication
JWT bearer authentication, the standard for [OAuth2](https://oauth.net/2/) and
[OIDC](https://openid.net/connect/) flows. The service validates tokens against an
`IdentityProvider` authority you configure. See
[Authentication & Authorization](./authentication-authorization.md).

### Authorization
Role-based authorization through ASP.NET's request authorization filters. This is the
familiar `[Authorize(Roles = "...")]` model, with the role claim mapping pre-configured.
See [Authentication & Authorization](./authentication-authorization.md).

### API documentation (Swagger and OpenAPI)
Swagger UI is generated automatically and wired up as an **OIDC client**, so developers can
log in and exercise secured endpoints directly from the docs. XML comments can be surfaced
into the spec. See [Swagger & OpenAPI](./swagger.md).

### Data persistence with auditing
Entity Framework Core integration via `AuditableDbContext`, which automatically stamps
`CreatedBy`, `CreatedOnUtc`, `UpdatedBy`, `UpdatedOnUtc`, and `UpdateCount` on entities that
implement `IAuditable`. See [Entity Framework](../data/entity-framework.md).

### Multi-tenancy
A request authorization filter (`CoreTenantFilterAttribute`) scopes requests to a tenant, backed by
the `ITentantable` model interface. See
[Models and Interfaces](../data/models-and-interfaces.md).

### Versioning
Both API routes and models are versioned, following the
[Microsoft REST API Guidelines](https://github.com/Microsoft/api-guidelines/blob/master/Guidelines.md#12-versioning).
Versions appear in the URL (`/api/v1/...`) and in the Swagger document dropdown. See
[Versioning](./versioning.md).

### Logging
Pluggable structured logging to **Application Insights**, **Elasticsearch**, or **Splunk**
via dedicated packages, chosen with a single `Setup*` call in your `Startup`. See
[Logging](../logging/overview.md).

### Eventing
Publish and subscribe messaging over **Azure Service Bus** or **Redis Streams**, with a
strong emphasis on keeping microservices decoupled (no service should call another
synchronously). See [Eventing](../eventing/overview.md).

### Testability
"Unigration" testing base classes spin up an in-memory or containerized service so you can
test the full request pipeline. NRSRx services routinely reach **95%+ code coverage**. See
[Unigration Testing](../testing/unigration.md).

### Health checks
A `/healthz` endpoint is always mapped. You add checks (database, dependencies) in
`SetupHealthChecks`.

### Build and version traceability
`GetBuildNumber()` reads the assembly's file and version attributes so a running instance
can report exactly which build it is.

## Adaptability: take what you need

> Most features built into NRSRx are customizable or removable altogether. Don't want
> authentication? Remove it. Nothing is `private`, `internal`, or `sealed`.

Each concern above corresponds to one or more `virtual` methods on the base `Startup`. To
**remove** a concern, override its method with an empty body. To **replace** it, override
and provide your own implementation. To **extend** it, override and call `base`.

```csharp
// Example: opt out of Swagger entirely
public override bool DisableSwagger => true;

// Example: replace JWT validation wholesale
public override void SetupAuthentication(AuthenticationBuilder builder)
{
  // your custom scheme here. Do not call base.
}
```
