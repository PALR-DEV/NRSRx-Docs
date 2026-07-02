---
id: models-and-interfaces
title: Models & Interfaces
sidebar_label: Models & Interfaces
---

# Models & Interfaces

In NRSRx, your model classes **opt into framework behavior by implementing interfaces**.
Implement `IIdentifiable` and you get a primary key and OData support. Implement
`IAuditable` and the DbContext stamps audit fields for you. And so on.

These contract interfaces live in **`IkeMtz.NRSRx.Core.Models`**.

## The core interfaces

### IIdentifiable

Gives an entity a unique identifier. The non-generic form uses a `Guid`, and the generic
form lets you choose the key type.

```csharp
public interface IIdentifiable : IIdentifiable<Guid> { }

public interface IIdentifiable<TIdentityType> where TIdentityType : IComparable
{
  [Key]
  TIdentityType Id { get; set; }
}
```

```csharp
public class Person : IIdentifiable
{
  public Guid Id { get; set; }
}
```

Implementing `IIdentifiable` is what lets a type participate in OData entity sets, the
`SimpleMapper`, and the generic publisher (`IPublisher<TEntity, TEvent>`).

:::tip Naming
The key property is always `Id`, not `PersonId`. This commonality is what makes the shared
interfaces and tooling work. See [Best Practices](../reference/best-practices.md).
:::

### IAuditable

Adds audit fields that the [`AuditableDbContext`](./entity-framework.md) populates
automatically on every save:

```csharp
public interface IAuditable<TDATETIME> where TDATETIME : struct
{
  [Required, MaxLength(250)] string CreatedBy { get; set; }
  [MaxLength(250)]           string? UpdatedBy { get; set; }
  int? UpdateCount { get; set; }
  TDATETIME  CreatedOnUtc { get; set; }
  TDATETIME? UpdatedOnUtc { get; set; }
}

public interface IAuditable : IAuditable<DateTimeOffset> { }
```

| Field | Set when | By |
| --- | --- | --- |
| `CreatedBy` | On insert | Current user id from `ICurrentUserProvider`. |
| `CreatedOnUtc` | On insert | `DateTime.UtcNow` (unless already set). |
| `UpdatedBy` | On update | Current user id. |
| `UpdatedOnUtc` | On update | `DateTime.UtcNow`. |
| `UpdateCount` | On update | Incremented each update. |

:::note Early stamping
`AuditableDbContext.AddAsync<TEntity>` also calls `OnIAuditableCreate` immediately — so
audit fields are stamped at the moment you call `db.AddAsync(entity)`, not just at
`SaveChanges` time.
:::

### ICalculateable

For entities with derived or persisted values. Implement `CalculateValues()` and the
DbContext calls it before saving, so you compute once and store the result rather than
recomputing on every read:

```csharp
public class Order : IIdentifiable, ICalculateable
{
  public Guid Id { get; set; }
  public int ItemQty { get; set; }
  public decimal Total { get; set; }
  public decimal AvgItemPrice { get; set; }

  public void CalculateValues() =>
    AvgItemPrice = ItemQty == 0 ? 0 : Total / ItemQty;
}
```

### IDeletable

Supports **soft deletion**: marking a record as deleted rather than removing the row, so
history is preserved.

```csharp
public interface IDeletable
{
  DateTimeOffset? DeletedOnUtc { get; set; }
  [MaxLength(256)]
  string? DeletedBy { get; set; }
}
```

:::caution Not automated by the base context
Despite the XML doc comments on the interface, the current `AuditableDbContext` does
**not** intercept deletes — it never stamps `DeletedOnUtc`/`DeletedBy` for you. Set these
fields yourself (e.g., in the controller or an `OnIAuditableUpdate` override) instead of
calling `Remove()` when you want a soft delete.
:::

To hide soft-deleted records from queries, add a global EF query filter:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
  modelBuilder.Entity<Course>()
    .HasQueryFilter(c => c.DeletedOnUtc == null);
}
```

### IEnableable

Adds an `IsEnabled` flag for toggling records on and off without deleting them.

:::caution Not automated by the base context
As with `IDeletable`, the interface's XML comments suggest `AuditableDbContext` manages
this flag, but the current implementation contains no `IEnableable` handling — set
`IsEnabled` explicitly in your own code.
:::

```csharp
public interface IEnableable
{
  bool IsEnabled { get; set; }
}
```

```csharp
public class Feature : IIdentifiable, IEnableable
{
  public Guid Id { get; set; }
  public string Name { get; set; }
  public bool IsEnabled { get; set; }
}
```

### ITentantable

:::caution Spelling note
The interface name in the source code is `ITentantable` (double `t`) — a typo that is
preserved for backwards compatibility. Using `ITenantable` (correct English spelling) in
your code will produce a compile error. Always use `ITentantable`.
:::

Marks an entity as belonging to a tenant, enabling multi-tenant data scoping in
combination with `CoreTenantFilterAttribute`. See [Multi-Tenancy](../concepts/multi-tenancy.md).

```csharp
public interface ITentantable
{
  string TenantId { get; set; }
}
```

```csharp
public class Document : IIdentifiable, ITentantable
{
  public Guid Id { get; set; }
  public string TenantId { get; set; }
  public string Content { get; set; }
}
```

### IEnumValue

Used for enum-backed lookup entities — the pattern of storing C# enums as database lookup
tables for referential integrity and query performance:

```csharp
public interface IEnumValue : IEnumValue<int> { }

public interface IEnumValue<TIdentityType> : IIdentifiable<TIdentityType>
  where TIdentityType : IComparable
{
  string Name { get; set; }
}
```

Use `EnumHelper.ConvertEnumValues<TEnum, TEnumValueType>()` to seed the table from a C#
enum in EF migrations or startup:

```csharp
public enum CourseLevel { Beginner = 1, Intermediate = 2, Advanced = 3 }

public class CourseLevelLookup : IEnumValue
{
  public int Id { get; set; }
  public string Name { get; set; }
}

// In OnModelCreating or a migration seed:
modelBuilder.Entity<CourseLevelLookup>().HasData(
  EnumHelper.ConvertEnumValues<CourseLevel, CourseLevelLookup>()
);
```

`EnumHelper` also provides `ToIEnumerable<TEnum>()` which returns
`IEnumerable<(int Id, string Name)>` tuples — useful when you just need the values without
an entity class. Both helpers have generic-key overloads for non-`int` identifiers:
`ToIEnumerable<TEnum, TKeyType>()` and
`ConvertEnumValues<TEnum, TIdentityType, TEnumValueType>()`.

## Putting it together

A typical auditable entity combines several interfaces:

```csharp
public partial class Course : CourseUpsertRequest, IIdentifiable, IAuditable, IDeletable
{
  public Course()
  {
    StudentCourses = new HashSet<StudentCourse>();
    SchoolCourses  = new HashSet<SchoolCourse>();
  }

  [DefaultValue(0)] public double? AvgScore { get; set; }

  // IAuditable
  [Required, MaxLength(250)] public string CreatedBy { get; set; }
  [Required] public DateTimeOffset CreatedOnUtc { get; set; }
  [MaxLength(250)] public string? UpdatedBy { get; set; }
  public DateTimeOffset? UpdatedOnUtc { get; set; }
  public int? UpdateCount { get; set; }

  // IDeletable
  public DateTimeOffset? DeletedOnUtc { get; set; }
  [MaxLength(256)] public string? DeletedBy { get; set; }

  // navigation properties
  public virtual ICollection<StudentCourse> StudentCourses { get; }
  public virtual ICollection<SchoolCourse> SchoolCourses { get; }
}
```

Notice `Course` inherits from `CourseUpsertRequest`. That's the **upsert pattern**: the
request DTO holds client-settable fields, and the entity adds server-managed ones (audit
fields, navigations). See [WebApi: The Upsert pattern](../flavors/webapi.md#the-upsert-pattern).

## Extra validation attributes

`IkeMtz.NRSRx.Core.Models` also ships validation attributes that fill gaps in the built-in
set:

| Attribute | Validates that |
| --- | --- |
| `RequiredNonDefault` | The value is not the type's default (for example, a `Guid` isn't `Guid.Empty`, an `int` isn't `0`). |
| `RequiredNonEmpty` | A collection or string is present **and** not empty. |

```csharp
public class StudentUpsertRequest : IIdentifiable
{
  public Guid Id { get; set; }

  [RequiredNonDefault]            // Guid.Empty is rejected
  public Guid SchoolId { get; set; }

  [RequiredNonEmpty]              // empty list is rejected
  public ICollection<Guid> CourseIds { get; set; }
}
```

## UserProvider — fixed user ID

`UserProvider` (base class in `IkeMtz.NRSRx.Core.Models`) is a simple
`ICurrentUserProvider` that returns a fixed string. It is the base for
`SystemUserProvider` (from `IkeMtz.NRSRx.Core.EntityFramework`) and is also useful in
unit tests:

```csharp
// In a unit test that needs a deterministic user ID:
var db = new DatabaseContext(options, new UserProvider("test-user-id"));
```

:::note defaultValue wins
`UserProvider.GetCurrentUserId(defaultValue)` returns `defaultValue ?? UserId` — so if a
caller passes a non-null `defaultValue`, that value is returned *instead of* the fixed
user ID, not just as a fallback.
:::

`SystemUserProvider` returns `"NRSRx System User"` and is the standard choice for jobs
and other non-HTTP contexts. You can change the string globally via
`SystemUserProvider.SystemUserId`.

## Where these are used

* **OData** uses `IIdentifiable` to build entity sets. See [OData](../flavors/odata.md).
* **EF auditing** uses `IAuditable`, `IDeletable`, and `ICalculateable`. See
  [Entity Framework](./entity-framework.md).
* **SimpleMapper** uses `IIdentifiable` to know what to skip. See
  [SimpleMapper](./simple-mapper.md).
* **Publishers** require `IIdentifiable<TKey>`. See [Publishers](../eventing/publishers.md).
* **Multi-tenancy** uses `ITentantable`. See [Multi-Tenancy](../concepts/multi-tenancy.md).
