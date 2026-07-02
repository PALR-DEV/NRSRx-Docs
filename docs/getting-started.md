---
id: getting-started
title: Getting Started
sidebar_label: Getting Started
sidebar_position: 2
---

# Getting Started

This guide takes you from an empty folder to a running, authenticated, documented WebApi
microservice. It mirrors the structure of the `IkeMtz.Samples.WebApi` sample in the
repository, so you can always compare against working code.

## Prerequisites

* **.NET SDK 8 or 9** (NRSRx supports ASP.NET 6 through 9).
* A database for persistence. The samples use **SQL Server**, but LocalDB or a container
  works fine.
* An **OpenID Connect / OAuth2 identity provider** for JWT authentication, such as Azure
  AD, Auth0, IdentityServer, or Keycloak. For local experimentation you can disable auth.
  See [Authentication & Authorization](./concepts/authentication-authorization.md).

---

## 1. Create the project

```bash
dotnet new webapi -n MyService --no-openapi
cd MyService
```

## 2. Add the NRSRx packages

For a WebApi flavor service you need the WebApi base, the EF integration, and a SQL
provider:

```bash
dotnet add package IkeMtz.NRSRx.Core.WebApi
dotnet add package IkeMtz.NRSRx.Core.EntityFramework
dotnet add package Microsoft.EntityFrameworkCore.SqlServer
```

> See [Reference: Packages](./reference/packages.md) for the full catalog, including OData,
> SignalR, eventing, jobs, and logging packages.

## 3. Define a model

Models implement framework interfaces to opt into behavior. `IIdentifiable` gives the
entity a `Guid Id`, and `IAuditable` adds the audit fields the DbContext fills in
automatically.

```csharp
using IkeMtz.NRSRx.Core.Models;
using System.ComponentModel.DataAnnotations;

public class Course : IIdentifiable, IAuditable
{
  public Guid Id { get; set; }

  [Required, MaxLength(100)]
  public string Title { get; set; }

  // IAuditable fields, populated automatically on save.
  [Required, MaxLength(250)]
  public string CreatedBy { get; set; }
  public DateTimeOffset CreatedOnUtc { get; set; }
  [MaxLength(250)]
  public string? UpdatedBy { get; set; }
  public DateTimeOffset? UpdatedOnUtc { get; set; }
  public int? UpdateCount { get; set; }
}
```

Pair the entity with a **request DTO** that contains only the fields a client is allowed to
send. `SimpleMapper` copies the DTO onto the entity while skipping server-managed fields
(`Id`, audit fields):

```csharp
public class CourseUpsertRequest : IIdentifiable
{
  public Guid Id { get; set; }

  [Required, MaxLength(100)]
  public string Title { get; set; }
}
```

See [Data & Models: Models and Interfaces](./data/models-and-interfaces.md) for the full
set of interfaces (`IEnableable`, `IDeletable`, `ITentantable`, `ICalculateable`, and more).

## 4. Create an auditable DbContext

Inherit from `AuditableDbContext` instead of `DbContext`. It accepts an
`ICurrentUserProvider` (NRSRx registers an HTTP-aware one for you) and stamps audit fields
on every `SaveChanges`.

```csharp
using IkeMtz.NRSRx.Core;
using IkeMtz.NRSRx.Core.EntityFramework;
using Microsoft.EntityFrameworkCore;

public class DatabaseContext : AuditableDbContext
{
  public DatabaseContext(DbContextOptions<DatabaseContext> options, ICurrentUserProvider currentUserProvider)
    : base(options, currentUserProvider) { }

  public virtual DbSet<Course> Courses { get; set; }
}
```

## 5. Write the Startup

This is the heart of an NRSRx service. Inherit from `CoreWebApiStartup` and override the
handful of methods that are specific to *your* service.

```csharp
using System.Reflection;
using IkeMtz.NRSRx.Core.WebApi;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

public class Startup : CoreWebApiStartup
{
  public override string ServiceTitle => "My Service";
  public override Assembly StartupAssembly => typeof(Startup).Assembly;

  // Surface your XML doc comments in Swagger.
  public override bool IncludeXmlCommentsInSwaggerDocs => true;

  public Startup(IConfiguration configuration) : base(configuration) { }

  public override void SetupDatabase(IServiceCollection services, string connectionString) =>
    services.AddDbContext<DatabaseContext>(x => x.UseSqlServer(connectionString));

  public override void SetupHealthChecks(IServiceCollection services, IHealthChecksBuilder checks) =>
    checks.AddDbContextCheck<DatabaseContext>();
}
```

> If you wire up one of the logging packages, call `.UseLogging()` before `.Build()`. See
> [Logging](./logging/overview.md).

## 6. Bootstrap in Program.cs

```csharp
using IkeMtz.NRSRx.Core.Web;

public static class Program
{
  public static void Main() =>
    CoreWebStartup.CreateDefaultHostBuilder<Startup>()
      .Build()
      .Run();
}
```

## 7. Add a versioned controller

NRSRx routes are versioned by URL segment (`/api/v1/...`). Decorate your controller with
`[ApiVersion]` and the versioned route template.

```csharp
using IkeMtz.NRSRx.Core.Models;
using IkeMtz.NRSRx.Core.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using static Microsoft.AspNetCore.Http.StatusCodes;

[Route("api/v{version:apiVersion}/[controller].{format}"), FormatFilter]
[ApiVersion("1.0")]
[ApiController]
[Authorize]
public class CoursesController(DatabaseContext db, ILogger<CoursesController> logger) : ControllerBase
{
  [HttpGet]
  [ProducesResponseType(Status200OK, Type = typeof(Course))]
  public async Task<ActionResult> Get([FromQuery] Guid id) =>
    Ok(await db.Courses.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id));

  [HttpPost]
  [ValidateModel]   // returns 400 automatically if the model is invalid
  [ProducesResponseType(Status200OK, Type = typeof(Course))]
  public async Task<ActionResult> Post([FromBody] CourseUpsertRequest request)
  {
    var value = SimpleMapper<CourseUpsertRequest, Course>.Instance.Convert(request);
    value.Id = request.Id;  // SimpleMapper skips Id; carry it from the request
    var entry = db.Courses.Add(value);
    await db.SaveChangesAsync(logger);
    return Ok(entry.Entity);
  }
}
```

The `[ValidateModel]`, `[ValidateMatchingId]`, and `SimpleMapper` come from NRSRx. See the
[WebApi flavor](./flavors/webapi.md) for a full CRUD controller and a deeper explanation
of the upsert pattern.

## 8. Configure settings

Provide the connection string and identity provider via `appsettings.json`, User Secrets,
or environment variables:

```json
{
  "DbConnectionString": "Server=(localdb)\\mssqllocaldb;Database=MyService;Trusted_Connection=True;",
  "IdentityProvider": "https://login.example.com/",
  "IdentityAudiences": "my-service-api",
  "SwaggerClientId": "my-service-swagger"
}
```

See [Configuration](./concepts/configuration.md) for every key NRSRx reads.

## 9. Run it

```bash
dotnet run
```

Then open the root URL in a browser. You'll get the **Swagger UI**, pre-configured as an
OIDC client so you can authenticate and call your endpoints. A health endpoint is exposed
at **`/healthz`**.

---

## What you got for free

Without writing any plumbing, your service now has:

* Layered configuration (JSON, secrets, and env vars)
* JWT bearer authentication against your OIDC provider
* Role-based authorization (`[Authorize]`)
* Swagger UI and OpenAPI docs with login
* URL-segment API versioning (`/api/v1/...`)
* Automatic audit stamping on every save
* A `/healthz` health-check endpoint
* Newtonsoft JSON with camelCasing, enum-as-string, and XML formatter support

## Next steps

* Understand exactly what the base class did in [Architecture](./concepts/architecture.md).
* Add event publishing with [Eventing: Publishers](./eventing/publishers.md).
* Write high-coverage tests with [Testing: Unigration](./testing/unigration.md).
