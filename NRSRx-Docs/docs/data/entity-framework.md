---
id: entity-framework
title: Entity Framework & Auditing
sidebar_label: Entity Framework
---

# Entity Framework & Auditing

NRSRx's data layer is **Entity Framework Core** with one big value-add: an
`AuditableDbContext` that automatically stamps *who* and *when* on your records, and runs
calculated-value logic, on every save.

* **Package:** `IkeMtz.NRSRx.Core.EntityFramework`

## AuditableDbContext

Instead of inheriting from `DbContext`, inherit from `AuditableDbContext`. It takes an
`ICurrentUserProvider` (NRSRx supplies an HTTP-aware one) so it knows the current user:

```csharp
public class DatabaseContext : AuditableDbContext
{
  public DatabaseContext(DbContextOptions<DatabaseContext> options,
                         ICurrentUserProvider currentUserProvider)
    : base(options, currentUserProvider) { }

  public virtual DbSet<Course> Courses { get; set; }
  public virtual DbSet<School> Schools { get; set; }
  public virtual DbSet<Student> Students { get; set; }
}
```

Register it in your `Startup.SetupDatabase`:

```csharp
public override void SetupDatabase(IServiceCollection services, string connectionString) =>
  services.AddDbContext<DatabaseContext>(x => x.UseSqlServer(connectionString));

// For high-throughput read services (also required for BatchDataSaver):
services.AddDbContextPool<DatabaseContext>(x => x.UseSqlServer(connectionString));
```

## What happens on SaveChanges

Every `SaveChanges` and `SaveChangesAsync` override runs three steps before delegating to
the base EF implementation:

```csharp
public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken ct = default)
{
  CalculateValues();   // 1. run ICalculateable.CalculateValues() on changed entities
  AddAuditables();     // 2. stamp CreatedBy / CreatedOnUtc on Added entities
  UpdateAuditables();  // 3. stamp UpdatedBy / UpdatedOnUtc / UpdateCount on Modified entities
  return await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
}
```

:::note Early stamping on AddAsync
`AuditableDbContext.AddAsync<TEntity>` is also overridden: it calls `CalculateValues()` and
`OnIAuditableCreate()` immediately when you call `db.AddAsync(entity)`, before
`SaveChanges`. This means audit fields are stamped at add-time, not only at save-time.
:::

### Auditing

For each entity implementing [`IAuditable`](./models-and-interfaces.md#iauditable):

```csharp
public virtual void OnIAuditableCreate(IAuditable auditable)
{
  auditable.CreatedOnUtc = auditable.CreatedOnUtc.Year != 1
      ? auditable.CreatedOnUtc           // keep an explicitly provided value
      : DateTime.UtcNow;                 // otherwise stamp "now"
  auditable.CreatedBy = CurrentUserProvider.GetCurrentUserId();
}

public virtual void OnIAuditableUpdate(IAuditable auditable)
{
  auditable.UpdatedOnUtc = DateTime.UtcNow;
  auditable.UpdatedBy   = CurrentUserProvider.GetCurrentUserId();
  auditable.UpdateCount = (auditable.UpdateCount ?? 0) + 1;
}
```

So you never write `entity.CreatedBy = ...` by hand, and you can't forget to. The user id
comes from [`ICurrentUserProvider`](../concepts/authentication-authorization.md#who-is-the-current-user-icurrentuserprovider),
which is HTTP-aware in web services and can be a `SystemUserProvider` in jobs.

:::warning Misconfigured claim mapping
If `JwtNameClaimMapping` points to a claim that is absent from the token,
`AuditableDbContext` will throw `AuditableInvalidUserException`. This is intentional
fail-fast behavior to catch misconfigured claim mappings early. If you see this exception,
check the `JwtNameClaimMapping` property on your `Startup`.
:::

### Calculated values

For each entity implementing [`ICalculateable`](./models-and-interfaces.md#icalculateable),
`CalculateValues()` is invoked so persisted derived values stay correct before they hit the
database.

## Logging save results

`AuditableDbContext` adds overloads that take an `ILogger` and log the affected row count:

```csharp
await _databaseContext.SaveChangesAsync(logger);
// logs: "Save changes completed successfully, affected row count: {n}"
```

All four overloads are available: `SaveChanges(logger)`, `SaveChanges(acceptAll, logger)`,
`SaveChangesAsync(logger)`, and `SaveChangesAsync(acceptAll, logger)`.

## Health checks

Wire your context into the health endpoint so `/healthz` reflects DB connectivity:

```csharp
public override void SetupHealthChecks(IServiceCollection services, IHealthChecksBuilder checks) =>
  checks.AddDbContextCheck<DatabaseContext>();
```

## Migrations

`AuditableDbContext` is a normal EF Core `DbContext`, so the standard tooling applies:

```bash
dotnet ef migrations add InitialCreate
dotnet ef database update
```

## SystemUserProvider — jobs and non-HTTP contexts

When your service runs outside HTTP (e.g., a background job calling `SaveChanges`), there
is no HTTP context to read the user from. Register `SystemUserProvider` so the DbContext
can still stamp audit fields:

```csharp
public override void SetupUserProvider(IServiceCollection services) =>
  services.AddScoped<ICurrentUserProvider, SystemUserProvider>();
```

`SystemUserProvider` returns `"NRSRx System User"` by default. Change it globally:

```csharp
SystemUserProvider.SystemUserId = "my-service-account";
```

## ContextCollectionSyncer — syncing child collections on PUT

When processing a PUT that includes a child collection (e.g., a `Student` with a list of
`CourseIds`), you need to add new items, update existing ones, and delete removed ones.
`ContextCollectionSyncer` handles this diff for you in one call.

Three extension methods on `IAuditableDbContext`:

| Method | Key type |
| --- | --- |
| `SyncGuidCollections<TSource, TDest>(ctx, source, dest, updateLogic?)` | `Guid` |
| `SyncIntCollections<TSource, TDest>(ctx, source, dest, updateLogic?)`  | `int`  |
| `SyncCollections<TSource, TDest, TKey>(ctx, source, dest, updateLogic?)` | Any `IComparable` |

```csharp
[HttpPut("{id}")]
[ValidateModel]
public async Task<ActionResult> Put(
    [FromRoute] Guid id,
    [FromBody] StudentUpsertRequest request)
{
  var student = await _db.Students
      .Include(s => s.StudentCourses)
      .FirstOrDefaultAsync(s => s.Id == id);

  if (student == null) return NotFound();

  // Map scalar fields.
  SimpleMapper<StudentUpsertRequest, Student>.Instance.ApplyChanges(request, student);

  // Sync the StudentCourses child collection:
  // - adds rows for new CourseIds
  // - removes rows for deleted CourseIds
  // - updates existing rows
  _db.SyncGuidCollections(
      sourceCollection: request.StudentCourses,        // from the request DTO
      destinationCollection: student.StudentCourses);  // the EF navigation collection

  await _db.SaveChangesAsync(logger);
  return Ok(student);
}
```

If the source and destination types differ (e.g., `StudentCourseUpsertRequest` → `StudentCourse`),
`SyncCollections` automatically uses `SimpleMapper` to copy properties. You can pass a
custom `updateLogic` action to override the per-item mapping.

## BatchDataSaver — high-throughput bulk inserts

`BatchDataSaver<TDbContext, TEntity>` saves large collections in batches without the
overhead of change tracking or auditing.

:::warning No audit stamping
`BatchDataSaver` does **not** set `IAuditable` properties (`CreatedBy`, `CreatedOnUtc`,
etc.) for performance reasons. Set these fields yourself before calling
`SaveChangesInBatchAsync` if you need them.
:::

:::note Requires DbContext pooling
Use `AddDbContextPool<T>()` when registering your DbContext — the factory pattern requires it.
:::

```csharp
public class CourseImportService
{
  private readonly IBatchDataSaver<DatabaseContext, Course> _batchSaver;
  private readonly IDbContextFactory<DatabaseContext> _dbContextFactory;

  public CourseImportService(
      IBatchDataSaver<DatabaseContext, Course> batchSaver,
      IDbContextFactory<DatabaseContext> dbContextFactory)
  {
    _batchSaver = batchSaver;
    _dbContextFactory = dbContextFactory;
  }

  public async Task ImportAsync(IEnumerable<Course> courses, ILogger logger)
  {
    // Stamp audit fields manually (BatchDataSaver skips this).
    var now = DateTimeOffset.UtcNow;
    foreach (var c in courses)
    {
      c.CreatedOnUtc = now;
      c.CreatedBy = "import-service";
    }

    // Saves in batches of 200 (default), logs progress per batch.
    var totalSaved = await _batchSaver.SaveChangesInBatchAsync(
        dbContextFactory: () => _dbContextFactory.CreateDbContext(),
        entities: courses,
        logger: logger,
        batchSize: 500);

    logger.LogInformation("Imported {Count} courses", totalSaved);
  }
}
```

Register both the saver and the EF context factory in `SetupDatabase`:

```csharp
public override void SetupDatabase(IServiceCollection services, string connectionString)
{
  services.AddDbContextPool<DatabaseContext>(x => x.UseSqlServer(connectionString));
  services.AddDbContextFactory<DatabaseContext>(x => x.UseSqlServer(connectionString));
  services.AddTransient<IBatchDataSaver<DatabaseContext, Course>,
                        BatchDataSaver<DatabaseContext, Course>>();
}
```

## Modeling guidance

NRSRx is opinionated about schema and entity design: plural table names, `Id` primary
keys, `Utc`-suffixed datetimes, navigation properties on both sides of relationships,
explicit enum values, and more. These conventions are what make the framework's automation
(OData, mapping, auditing) line up. See [Best Practices](../reference/best-practices.md)
for the full, example-driven list.
