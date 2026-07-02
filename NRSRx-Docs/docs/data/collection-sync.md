---
id: collection-sync
title: Collection Sync
sidebar_label: Collection Sync
---

# Collection Sync

`ContextCollectionSyncer` (in `IkeMtz.NRSRx.Core.EntityFramework`) handles the **add /
update / delete diff** when a PUT request includes a child collection. Instead of manually
comparing the incoming list against the database, you call one method and it does the diff
for you.

## The problem it solves

When you update a parent entity and include a child collection in the request body, you
need to:

1. **Add** items that are in the request but not in the database.
2. **Update** items that are in both (with new field values from the request).
3. **Remove** items that are in the database but not in the request.

Without a helper, this is repetitive EF boilerplate. `ContextCollectionSyncer` encapsulates
it as a set of extension methods on `IAuditableDbContext`.

## API

Three extension methods cover the common key types:

```csharp
// For Guid-keyed child collections (most common).
dbContext.SyncGuidCollections<TSource, TDest>(
    sourceCollection,      // from the request DTO
    destinationCollection, // the EF navigation property
    updateLogic?);         // optional: custom per-item mapping

// For int-keyed child collections.
dbContext.SyncIntCollections<TSource, TDest>(
    sourceCollection, destinationCollection, updateLogic?);

// For any IComparable key type.
dbContext.SyncCollections<TSource, TDest, TKey>(
    sourceCollection, destinationCollection, updateLogic?);
```

All three perform the same diff:

1. Items in `destinationCollection` whose `Id` is not in `sourceCollection` → removed
   from the collection and deleted from the context.
2. Items whose `Id` exists in both → `updateLogic` is called to copy fields.
3. Items in `sourceCollection` whose `Id` is not in `destinationCollection` → a new
   `TDest` instance is created, `updateLogic` is called, and it is added to the collection.

If `updateLogic` is `null`, `SimpleMapper<TSource, TDest, TKey>.Instance.ApplyChanges`
is used automatically.

## Example: syncing StudentCourses on PUT

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

  // 1. Update the student's own scalar fields.
  SimpleMapper<StudentUpsertRequest, Student>.Instance.ApplyChanges(request, student);

  // 2. Sync the child collection.
  //    - Adds new StudentCourse rows for any CourseId not already in the DB.
  //    - Updates existing rows with fields from the request DTO.
  //    - Removes rows for CourseIds that were removed from the request.
  _db.SyncGuidCollections(
      sourceCollection:      request.StudentCourses,   // ICollection<StudentCourseUpsertRequest>
      destinationCollection: student.StudentCourses);  // ICollection<StudentCourse> (EF nav)

  await _db.SaveChangesAsync(logger);
  return Ok(student);
}
```

## Custom update logic

Pass an `Action<TSource, TDest>` to override the default `SimpleMapper` behavior for
updated items:

```csharp
_db.SyncGuidCollections(
    sourceCollection: request.StudentCourses,
    destinationCollection: student.StudentCourses,
    updateLogic: (src, dest) =>
    {
      dest.EnrollmentDate = src.EnrollmentDate;
      dest.Grade          = src.Grade;
      // Id is intentionally not copied (managed by the diff).
    });
```

## Important notes

- `SyncCollections` requires the `IAuditableDbContext` interface (implemented by
  `AuditableDbContext`). If your context doesn't extend `AuditableDbContext`, you won't
  have access to these extension methods.
- Removed items are deleted from the EF context immediately via `auditableContext.Remove(destItem)`.
  They will be deleted from the database when `SaveChanges` is called.
- New items whose `Id` in the source is `Guid.Empty` are assigned a new `Guid.Empty` id
  (left for the database to assign if you're using identity columns). Otherwise the source
  `Id` is carried over.
- The `sourceCollection` can be `null` — it is treated as an empty collection, so all
  destination items are removed.

## Registering types for SimpleMapper (default update logic)

When using the default `updateLogic` (SimpleMapper), ensure your source and destination
types are compatible. SimpleMapper copies properties with matching names and compatible
types, skipping `Id` and audit fields by default. See
[SimpleMapper](./simple-mapper.md) for full details.
