---
id: webapi
title: WebApi Flavor
sidebar_label: WebApi
---

# WebApi Flavor

The WebApi flavor is for **classic REST controllers**. It's the right choice when your
service owns and persists domain state: creating, updating, and deleting records, with
validation and auditing.

* **Package:** `IkeMtz.NRSRx.Core.WebApi`
* **Base class:** `CoreWebApiStartup`

## The Startup

Inherit from `CoreWebApiStartup` and override the service-specific pieces:

```csharp
public class Startup : CoreWebApiStartup
{
  public override string ServiceTitle => "Samples WebApi Microservice";
  public override Assembly StartupAssembly => typeof(Startup).Assembly;
  public override bool IncludeXmlCommentsInSwaggerDocs => true;
  public override string[] AdditionalAssemblyXmlDocumentFiles => new[]
  {
    typeof(Course).Assembly.Location.Replace(".dll", ".xml",
      StringComparison.InvariantCultureIgnoreCase)
  };

  public Startup(IConfiguration configuration) : base(configuration) { }

  public override void SetupDatabase(IServiceCollection services, string connectionString) =>
    services.AddDbContext<DatabaseContext>(x => x.UseSqlServer(connectionString));

  public override void SetupLogging(IServiceCollection? services = null, IApplicationBuilder? app = null) =>
    this.SetupElasticsearch(app);

  public override void SetupHealthChecks(IServiceCollection services, IHealthChecksBuilder checks) =>
    checks.AddDbContextCheck<DatabaseContext>();
}
```

The base class handles MVC, Newtonsoft JSON (camelCase and enum-as-string), API versioning,
Swagger, auth, and health checks. See [Architecture](../concepts/architecture.md).

## Controllers

A WebApi controller is a standard `ControllerBase` with NRSRx's versioned route and the
validation attributes:

```csharp
[Route("api/v{version:apiVersion}/[controller].{format}"), FormatFilter]
[ApiVersion(VersionDefinitions.v1_0)]
[ApiController]
[Authorize]
public class CoursesController(DatabaseContext db, ILogger<CoursesController> logger)
  : ControllerBase
{
  [HttpGet]
  [ProducesResponseType(Status200OK, Type = typeof(Course))]
  public async Task<ActionResult> Get([FromQuery] Guid id)
  {
    var obj = await db.Courses.AsNoTracking()
      .FirstOrDefaultAsync(t => t.Id == id);
    return Ok(obj);
  }

  [HttpPost]
  [ProducesResponseType(Status200OK, Type = typeof(Course))]
  [ValidateModel]
  public async Task<ActionResult> Post([FromBody] CourseUpsertRequest request)
  {
    var value = SimpleMapper<CourseUpsertRequest, Course>.Instance.Convert(request);
    value.Id = request.Id;
    var entry = db.Courses.Add(value);
    await db.SaveChangesAsync(logger);
    return Ok(entry.Entity);
  }

  [HttpPut]
  [ProducesResponseType(Status200OK, Type = typeof(Course))]
  [ValidateModel]
  [ValidateMatchingId]
  public async Task<ActionResult> Put([FromQuery] Guid id, [FromBody] CourseUpsertRequest request)
  {
    var obj = await db.Courses.FirstOrDefaultAsync(t => t.Id == id);
    SimpleMapper<CourseUpsertRequest, Course>.Instance.ApplyChanges(request, obj);
    await db.SaveChangesAsync(logger);
    return Ok(obj);
  }

  [HttpDelete]
  [ProducesResponseType(Status200OK, Type = typeof(Course))]
  public async Task<ActionResult> Delete([FromQuery] Guid id)
  {
    var obj = await db.Courses.FirstOrDefaultAsync(t => t.Id == id);
    if (obj == null) return NotFound("Invalid Id");
    db.Remove(obj);
    await db.SaveChangesAsync(logger);
    return Ok(obj);
  }
}
```

### What's NRSRx here?

| Element | Comes from | Purpose |
| --- | --- | --- |
| `[ValidateModel]` | `IkeMtz.NRSRx.Core.Web` | Short-circuits with **400 Bad Request** if `ModelState` is invalid, so you skip the boilerplate `if (!ModelState.IsValid)`. |
| `[ValidateMatchingId]` | `IkeMtz.NRSRx.Core.Web` | Ensures the `id` in the query or route matches the `Id` in the body for updates. |
| `SimpleMapper<TSource, TDest>` | `IkeMtz.NRSRx.Core.Models` | Convention-based mapper that copies matching properties while ignoring `Id` and audit fields. See [SimpleMapper](../data/simple-mapper.md). |
| `SaveChangesAsync(logger)` | `AuditableDbContext` | Saves *and* logs the affected row count, and also stamps audit fields. See [Entity Framework](../data/entity-framework.md). |

## The Upsert pattern

Notice the controller binds to a `CourseUpsertRequest`, not the full `Course` entity. This
is a deliberate pattern:

* **`CourseUpsertRequest`** holds only the fields a client is allowed to *send*.
* **`Course`** is the full entity, including server-managed fields (`Id`, audit fields,
  navigation collections).

`SimpleMapper` maps the request onto the entity, automatically skipping `Id`, `CreatedBy`,
`CreatedOnUtc`, `UpdatedBy`, and `UpdatedOnUtc`, so clients can never spoof those.

## Validation

Validation is data-annotation based. Decorate your request and model properties:

```csharp
public class CourseUpsertRequest : IIdentifiable
{
  public Guid Id { get; set; }

  [Required, MaxLength(100)]
  public string Title { get; set; }

  [Range(0, 100)]
  public double? AvgScore { get; set; }
}
```

`[ValidateModel]` then enforces them and returns 400 with the validation details. NRSRx
also ships extra annotations such as `RequiredNonDefault` and `RequiredNonEmpty` (in
`IkeMtz.NRSRx.Core.Models`) for cases the built-ins don't cover.

The guideline behind this:

> Microservices should validate each piece of input data: string lengths, nullable fields,
> data types, and so on.

## Emitting events

A common WebApi pattern is to publish a domain event after a write so other services can
react. See [Eventing: Publishers](../eventing/publishers.md) for the
`IPublisher<TEntity, TEvent>` pattern. The `Samples.Events.Redis` service is a WebApi that
publishes `Created`, `Updated`, and `Deleted` events to Redis instead of writing to a
database.
