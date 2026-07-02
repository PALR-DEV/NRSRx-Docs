---
id: odata
title: OData Flavor
sidebar_label: OData
---

# OData Flavor

The OData flavor exposes **rich, queryable read endpoints**. Instead of writing a bespoke
endpoint for every filter, sort, and page combination a client might want, you expose an
`IQueryable<T>` and let clients shape the query themselves with OData syntax: `$filter`,
`$select`, `$expand`, `$orderby`, `$top`, `$skip`, and more.

* **Package:** `IkeMtz.NRSRx.Core.OData`
* **Base class:** `CoreODataStartup`

## The Startup

Beyond the usual overrides, an OData startup supplies an **EDM model provider** and can
cap the page size with `MaxTop`:

```csharp
public class Startup : CoreODataStartup
{
  public override int? MaxTop { get; set; } = 500;
  public override string ServiceTitle => "Samples OData Microservice";
  public override Assembly StartupAssembly => typeof(Startup).Assembly;
  public override bool IncludeXmlCommentsInSwaggerDocs => true;

  public override BaseODataModelProvider ODataModelProvider => new ODataModelProvider();

  public Startup(IConfiguration configuration) : base(configuration) { }

  public override void SetupDatabase(IServiceCollection services, string connectionString) =>
    services.AddDbContextPool<DatabaseContext>(x => x.UseSqlServer(connectionString));

  public override void SetupLogging(IServiceCollection? services = null, IApplicationBuilder? app = null) =>
    this.SetupApplicationInsights(services);

  public override void SetupHealthChecks(IServiceCollection services, IHealthChecksBuilder checks) =>
    checks.AddDbContextCheck<DatabaseContext>();
}
```

> OData read services pair well with `AddDbContextPool` for throughput, since they're
> typically high volume and read only.

`MaxTop` defaults to `100` if you don't override it. Route components are registered per
EDM version at `odata/{version}` (e.g. `odata/v1`), with attribute routing enabled,
case-insensitive controller-name matching, and the OData `TimeZone` fixed to UTC.

In the `Development` environment, `CoreODataStartup.Configure` also calls
`app.UseODataRouteDebug()`, which exposes a route debug endpoint at `/$odata`. This is
useful when debugging why a particular query path is not resolving correctly.

## The EDM model provider

The **Entity Data Model (EDM)** describes which entity sets clients can query and how they
relate. Define it by extending `BaseODataModelProvider`:

```csharp
public class ODataModelProvider : BaseODataModelProvider
{
  public static IEdmModel GetV1EdmModel() =>
    ODataEntityModelFactory(builder =>
    {
      builder.EntitySet<V1.Course>($"{nameof(V1.Course)}s");
      builder.EntitySet<V1.School>($"{nameof(V1.School)}s");
      builder.EntitySet<V1.Student>($"{nameof(V1.Student)}s");
      builder.EntitySet<V1.SchoolCourse>($"{nameof(V1.SchoolCourse)}s");

      // a custom bound function
      builder.EntityType<V1.Student>()
        .Collection
        .Function("nolimit")
        .ReturnsCollectionFromEntitySet<V1.Student>($"{nameof(V1.Student)}s");
    });

  public override IDictionary<ApiVersionDescription, IEdmModel> GetModels() =>
    new Dictionary<ApiVersionDescription, IEdmModel>
    {
      [ApiVersionFactory(1, 0)] = GetV1EdmModel(),
    };
}
```

Each API version gets its own EDM model, which dovetails with NRSRx's
[versioning](../concepts/versioning.md): `v1` and `v2` can expose different shapes.

## Controllers

An OData controller derives from `ODataController` and returns an `IQueryable<T>`. The
`[EnableQuery]` attribute is what makes the OData query options work:

```csharp
[ApiVersion("1.0")]
[Authorize]
[ResponseCache(Location = ResponseCacheLocation.Any, Duration = 6000)]
public class CoursesController : ODataController
{
  private readonly DatabaseContext _db;
  public CoursesController(DatabaseContext db) => _db = db;

  [ProducesResponseType(typeof(ODataEnvelope<Course, Guid>), Status200OK)]
  [EnableQuery(MaxTop = 100, AllowedQueryOptions = AllowedQueryOptions.All)]
  [HttpGet]
  public IQueryable<Course> Get() => _db.Courses.AsNoTracking();
}
```

You return the *unfiltered* queryable, and OData translates the client's query options
into the EF query, which executes efficiently against the database.

### Restricting $expand with ExpandPermissionsFilterAttribute

To allow `$expand` only for users with specific permissions, apply
`ExpandPermissionsFilterAttribute`. Users without the permission get the base query without
the expand clause — no 401, just a silently pruned query:

```csharp
[HttpGet]
[EnableQuery]
[ExpandPermissionsFilter(new[] { "grades:read" }, expandClause: "Grades")]
public IQueryable<Student> Get() => _db.Students.AsNoTracking();
```

See [Authorization Filters](../reference/authorization-filters.md) for the full reference.

### EnableQuery options

| Option | Purpose |
| --- | --- |
| `MaxTop` | Caps `$top` so a client can't request unbounded result sets. |
| `AllowedQueryOptions` | Which OData options are permitted (`All`, or a restricted set). |

## Querying as a client

With the controller above, clients can do all of this without any extra server code:

```
GET /odata/v1/Courses?$filter=AvgScore gt 90&$orderby=Title&$top=10
GET /odata/v1/Courses?$select=Id,Title
GET /odata/v1/Courses?$expand=SchoolCourses
GET /odata/v1/Courses/$count
```

## The custom serializer: default values are omitted

`CoreODataStartup` registers `NrsrxODataSerializerProvider`, which swaps in
`NrsrxODataSerializer` for all entity and complex types. That serializer **omits
properties whose value is the type default** from the response payload:

* `null` properties are dropped.
* Numeric properties (`short`, `int`, `long`, `decimal`, `double`, `float`, and unsigned
  variants) equal to `0` are dropped.
* `DateTime` / `DateTimeOffset` properties equal to `default` (year 1) are dropped.

This keeps payloads lean, but be aware of the consequence: **a client cannot distinguish
"the score is 0" from "the score was not returned"** — a legitimate `0` or default date
simply doesn't appear in the JSON. Deserialize into types with defaulting semantics that
match. (OData payload validations are also disabled via
`ODataMessageWriterSettings.Validations = ValidationKinds.None`.)

## The response envelope: ODataEnvelope&lt;TEntity, TKey&gt;

OData responses are wrapped in an envelope (the `value` array, an optional `@odata.count`,
and so on). `ODataEnvelope<TEntity, TKey>` from `IkeMtz.NRSRx.Core.Models` models that
shape so you can declare an accurate `[ProducesResponseType]` and deserialize responses
strongly typed in tests and clients.

## Navigation properties matter

OData's `$expand` relies on your entities having well-defined navigation properties. As the
[best practices](../reference/best-practices.md) describe, define both sides of
relationships:

```csharp
public class Order : IIdentifiable
{
  public Guid Id { get; set; }
  public virtual ICollection<OrderLineItem> OrderLineItems { get; set; }
}
public class OrderLineItem : IIdentifiable
{
  public Guid Id { get; set; }
  public Guid OrderId { get; set; }
  public virtual Order Order { get; set; }
}
```

> Note: OData does **not** support self-referencing entities, so avoid parent/child
> navigation on the same type.

## Testing OData services

For unigration tests, use `CoreODataUnigrationTestStartup<TStartup>` (instead of the
WebApi variant). The test flow is the same — `TestWebHostBuilder`, `ExecuteOnContext`,
`GenerateAuthHeader` — but the startup class ensures OData routing is configured for the
in-memory test server.

```csharp
using var srv = new TestServer(
    TestWebHostBuilder<Startup, CoreODataUnigrationTestStartup<Startup>>());
```

See [Unigration Testing](../testing/unigration.md#testing-odata-endpoints) for a full
example with `$filter` and `ODataEnvelope` deserialization.
