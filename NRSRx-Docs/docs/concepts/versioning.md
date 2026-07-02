---
id: versioning
title: API & Model Versioning
sidebar_label: Versioning
---

# API & Model Versioning

Microservices evolve. New fields appear, old endpoints change shape. NRSRx bakes in
versioning so you can ship breaking changes without breaking existing consumers, following
the
[Microsoft REST API Guidelines](https://github.com/Microsoft/api-guidelines/blob/master/Guidelines.md#12-versioning).

## URL-segment versioning

NRSRx versions APIs by **URL segment**. The version is part of the path:

```
GET /api/v1/courses
GET /api/v2/courses
```

This is configured for you in `SetupCoreEndpointFunctionality`:

```csharp
services
  .AddApiVersioning(options =>
  {
    options.ReportApiVersions = true;                 // adds api-supported-versions header
    options.ApiVersionReader = new UrlSegmentApiVersionReader();
  })
  .AddVersionedApiExplorer(options =>
  {
    options.GroupNameFormat = "'v'VVV";               // e.g. "v1", "v1.1"
    options.SubstituteApiVersionInUrl = true;
  });
```

Because `ReportApiVersions` is on, responses include the `api-supported-versions` and
`api-deprecated-versions` headers, so consumers can discover the version landscape from any
response.

## Versioning a controller

Declare the version with `[ApiVersion]` and put the `{version:apiVersion}` token in the
route template:

```csharp
[Route("api/v{version:apiVersion}/[controller].{format}"), FormatFilter]
[ApiVersion("1.0")]
[ApiController]
public class CoursesController : ControllerBase { }
```

Many samples centralize the version strings in a `VersionDefinitions` class so they're not
repeated as magic strings:

```csharp
public static class VersionDefinitions
{
  public const string v1_0 = "1.0";
}

// usage
[ApiVersion(VersionDefinitions.v1_0)]
```

## Model versioning

NRSRx treats the **model** as versioned too, not just the route. The convention used
throughout the samples is to namespace models by version:

```
IkeMtz.Samples.Models.V1.Course
IkeMtz.Samples.Models.V2.Course
```

This means a `v1` controller binds to the `V1.Course` shape and a `v2` controller binds to
`V2.Course`. The two versions can differ freely (adding, removing, or reshaping properties)
without affecting each other. Consumers pinned to `/api/v1` keep getting the `V1` model.

The guidelines put it this way:

> Each microservice should be able to handle breaking changes to its model and endpoints
> via API versioning. The different versions and the discrepancies between the models
> should be communicated to developers via the OpenAPI spec documentation at a minimum.

## Versions in Swagger

The versioned API explorer feeds Swagger: each API version becomes its own Swagger
document, selectable from the dropdown in the Swagger UI. See
[Swagger & OpenAPI](./swagger.md).

## Build number and instance traceability

Separately from API versioning, every service can report which **build** is running.
`CoreWebStartup.GetBuildNumber()` reads the assembly's version attributes:

```csharp
public string GetBuildNumber() =>
  StartupAssembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version
  ?? StartupAssembly.GetCustomAttribute<AssemblyVersionAttribute>()?.Version
  ?? StartupAssembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
  ?? "unknown";
```

This satisfies the guideline that a running instance should let developers "easily track
down the source code for the running instance."
