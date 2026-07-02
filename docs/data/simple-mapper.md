---
id: simple-mapper
title: SimpleMapper
sidebar_label: SimpleMapper
---

# SimpleMapper

`SimpleMapper` is NRSRx's lightweight, convention-based object mapper. It copies matching
properties from a source object onto a destination object, and crucially it
**automatically ignores server-managed fields** like `Id` and the audit columns, so client
input can't overwrite them.

* **Package:** `IkeMtz.NRSRx.Core.Models`

## Why it exists

In the [upsert pattern](../flavors/webapi.md#the-upsert-pattern), a controller binds to a
request DTO (`CourseUpsertRequest`) and needs to copy its values onto an entity (`Course`)
without letting the client touch `Id`, `CreatedBy`, `CreatedOnUtc`, `UpdatedBy`, or
`UpdatedOnUtc`. `SimpleMapper` does exactly that, with zero configuration and no extra
dependency (unlike AutoMapper).

## The two operations

```csharp
var mapper = SimpleMapper<CourseUpsertRequest, Course>.Instance;

// 1. Convert: create a NEW destination and copy matching properties.
Course created = mapper.Convert(request);

// 2. ApplyChanges: copy matching properties onto an EXISTING destination.
mapper.ApplyChanges(request, existingCourse);
```

| Method | Use in | Behavior |
| --- | --- | --- |
| `Convert(source)` | **POST** (create) | News up a `TDestination` and maps onto it. |
| `ApplyChanges(source, dest)` | **PUT** (update) | Maps onto an entity you already loaded from the DB. |

### In a controller

```csharp
[HttpPost]
public async Task<ActionResult> Post([FromBody] CourseUpsertRequest request)
{
  var value = SimpleMapper<CourseUpsertRequest, Course>.Instance.Convert(request);
  value.Id = request.Id;                       // set the key explicitly
  var entry = db.Courses.Add(value);
  await db.SaveChangesAsync(logger);
  return Ok(entry.Entity);
}

[HttpPut]
public async Task<ActionResult> Put([FromQuery] Guid id, [FromBody] CourseUpsertRequest request)
{
  var obj = await db.Courses.FirstOrDefaultAsync(t => t.Id == id);
  SimpleMapper<CourseUpsertRequest, Course>.Instance.ApplyChanges(request, obj);
  await db.SaveChangesAsync(logger);
  return Ok(obj);
}
```

## What gets ignored

By design, these properties are **never** copied:

```csharp
IgnoredProperties = { "Id", "CreatedBy", "CreatedOnUtc", "UpdatedBy", "UpdatedOnUtc" };
```

And these property *types* are skipped (so identities and navigation collections aren't
mapped):

```csharp
IgnoredInterfaces = { IIdentifiable, IIdentifiable<>, ICollection<> };
```

So in the POST example above, `value.Id = request.Id;` is set explicitly *because* the
mapper deliberately skips `Id`. Audit fields are left for the
[`AuditableDbContext`](./entity-framework.md) to populate.

## How matching works

A property is mapped when the source and destination both have the **same name**
(case-sensitive) and the **same type**.

For a handful of numeric types (`int`, `long`, `decimal`, `float`, and their nullable
forms), `SimpleMapper` does a safe parse and convert, so close-but-not-identical numeric
types still map. Anything else requires an exact type match.

Two more behaviors worth knowing:

* If the source and destination values are already equal, the property is skipped (no
  redundant `SetValue`, which keeps EF change tracking quiet).
* `ApplyChanges` throws `ArgumentNullException` if either the source or the destination is
  `null` — guard the "entity not found" case before mapping.

## Generic variants

| Type | Use |
| --- | --- |
| `SimpleMapper<TSource, TDest>` | Map between two types. `TDest` must be `IIdentifiable<Guid>`. |
| `SimpleMapper<TEntity>` | Map within the **same** type (for example, clone updatable fields). |
| `SimpleMapper<TSource, TDest, TKey>` | Same as the two-type form, but with a non-`Guid` key. |

All are accessed through the cached `.Instance` singleton, which builds the property-map
plan once via reflection and reuses it, so repeated calls are cheap.

## When to reach for something else

`SimpleMapper` is intentionally *simple*: name and type matching, with a fixed ignore list.
If you need flattening, custom member mappings, conditional logic, or type converters, use a
full mapping library or hand-write the projection. For the common DTO-to-entity upsert case
that NRSRx services are built around, `SimpleMapper` is usually all you need.
