---
id: best-practices
title: Best Practices
sidebar_label: Best Practices
---

# Best Practices

NRSRx is **opinionated**, and those opinions are what make its conventions (OData, the
`SimpleMapper`, auditing) line up without configuration. This page distills the
project's database, Entity Framework, and microservice guidelines into a digestible
checklist.

> The complete, example-driven guidelines live in `guidelines.md` at the root of the
> repository. This is the condensed version.

## Database conventions

| Rule | Do | Don't |
| --- | --- | --- |
| **Plural table names** (ignore English rules) | `Persons`, `Activities` | `Person`, `People` |
| **PascalCase** names | `BirthDate` | `birthDate`, `birth_date` |
| **Primary key named `Id`** | `Id` | `PersonId` |
| **Key type fits the data** | `uniqueidentifier` for volatile, `int`/short code for stable lookups | random choices |
| **FKs are `{ParentSingular}Id`** | `OrderId` on `OrderLineItems` | `Order` |
| **Don't repeat the table name in columns** | `Persons.Name` | `Persons.PersonName` |
| **Avoid acronyms** | `ShortDescription` | `SD` |
| **UTC datetimes suffixed `Utc`** | `LastVisitUtc` | `LastVisit` |
| **Pure dates suffixed `Date`** | `BirthDate` | `DoB` |
| **Persist common calculations** | store `AvgItemPrice` | recompute every query |

The last point is deliberate: **performance over normalization**. Store frequently-read
derived values (and keep them current with [`ICalculateable`](../data/models-and-interfaces.md#icalculateable)).

## Entity Framework conventions

- **Entities are singular, `DbSet`s are plural** — `DbSet<Person> Persons` (not `People`).
- **Every entity has an `Id`** — implement [`IIdentifiable`](../data/models-and-interfaces.md#iidentifiable);
  it's required for OData and enables the shared interfaces.
- **Define navigation properties on both sides** of a relationship (parent collection +
  child reference). This powers OData `$expand`. *Exception:* OData doesn't support
  self-referencing entities.
- **Add audit fields to volatile data** via [`IAuditable`](../data/models-and-interfaces.md#iauditable);
  the [`AuditableDbContext`](../data/entity-framework.md) fills them in.
- **Add concurrency checks where correctness demands it** — a `[Timestamp] RowVersion` in
  SQL Server, or a `uint xmin` mapped to the system column in Postgres. (Note: this ties
  your code to a specific database.)

### Enums

- **Plural names** — `DepartmentNames`, not `DepartmentName`.
- **Explicit values** — `English = 1, Math = 2` (reordering must not shift stored values;
  use powers of two for flags).
- **Store enums in the database too** — create a lookup table + FK so BI tools and humans
  can decipher the data without the code. Use [`IEnumValue`](../data/models-and-interfaces.md#ienumvalue).
- **Enum properties follow the FK convention** — `DepartmentNameId`, not `DepartmentName`.

### Boolean & state fields

- **Booleans start with a verb** — `IsCompleted`, `HasShipped`, `ContainsErrors`.
- **Prefer a nullable `DateTime` over a `bool`** when you might later need to know *when*
  the state changed: `CompletedUtc` (null = false, a value = true *and* the timestamp).

## Microservice conventions

- **One service per business domain** — a service owns all the logic for its domain.
- **Clear, plural, PascalCase names** — for the service and its endpoints; avoid ambiguity
  in a distributed system.
- **Document every API** — OpenAPI/Swagger, with the same auth as the API itself. See
  [Swagger](../concepts/swagger.md).
- **Pick the right tool** — [OData](../flavors/odata.md) to serve/query data,
  [WebApi](../flavors/webapi.md) to persist state, [SignalR](../flavors/signalr.md) for
  real-time.
- **Decouple via events, never direct calls** — each service keeps its own copy of needed
  cross-domain data, refreshed through the [event bus](../eventing/overview.md).
- **Validate every input** — string lengths, nullability, types. Use
  [`[ValidateModel]`](../flavors/webapi.md#validation) and data annotations.
- **Authenticate every endpoint** — plus authorization levels matching the data owner. See
  [Auth](../concepts/authentication-authorization.md).
- **Version your API and models** — handle breaking changes gracefully and communicate them
  via OpenAPI. Report the running build number. See [Versioning](../concepts/versioning.md).
- **One writer per table** — ideally each service owns its repository; at minimum, only one
  service writes to any given table. Multiple writers make data corruption nearly
  impossible to debug.

## Why follow them?

These conventions aren't arbitrary style — they're the contract that lets NRSRx's
automation work:

- `Id`-named keys + `IIdentifiable` → OData entity sets, `SimpleMapper`, generic publishers.
- `IAuditable` fields → automatic audit stamping.
- Both-sided navigations → OData `$expand`.
- Versioned models → safe breaking changes.
- Event-based decoupling → resilient, independently scalable services.

Adopt them and the framework does the heavy lifting; deviate and you'll find yourself
fighting the conventions.
