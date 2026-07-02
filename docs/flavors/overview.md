---
id: overview
title: Service Flavors Overview
sidebar_label: Overview
---

# Service Flavors

NRSRx offers three "flavors" of service. A flavor is just a **base `Startup` class** (and
its NuGet package) tailored to a particular style of API. They all share the
`CoreWebStartup` foundation (config, auth, Swagger, versioning) and differ only in how they
expose endpoints.

> The guideline: *Microservices should be built around the technology best suited to meet
> business needs. If you need to serve data, OData is an excellent choice. If you need to
> persist domain objects and state, WebApi is the appropriate direction.*

## At a glance

| Flavor | Base class | Package | Best for |
| --- | --- | --- | --- |
| **[WebApi](./webapi.md)** | `CoreWebApiStartup` | `IkeMtz.NRSRx.Core.WebApi` | Commands and writes: create, update, and delete domain state, with validation and auditing. |
| **[OData](./odata.md)** | `CoreODataStartup` | `IkeMtz.NRSRx.Core.OData` | Queries and reads: rich, client-driven querying (`$filter`, `$select`, `$expand`, `$top`). |
| **[SignalR](./signalr.md)** | `CoreSignalrStartup` | `IkeMtz.NRSRx.Core.SignalR` | Real-time push: notifications and live updates over WebSockets. |

> A **GraphQL** flavor is noted as "coming soon" in the project README.

## How to choose

```
Do you need to PUSH updates to clients in real time?
        │
        ├── Yes ─────────────────────────────► SignalR
        │
        No
        │
Are clients mostly READING and need flexible queries
(filtering, sorting, paging, selecting fields)?
        │
        ├── Yes ─────────────────────────────► OData
        │
        No  (you're creating/updating/deleting state)
        │
        └────────────────────────────────────► WebApi
```

Many real systems use **more than one**: an OData service for read-heavy querying, a WebApi
service for writes that publishes events, and a SignalR service to push the results to
connected clients. They stay decoupled by communicating through
[events](../eventing/overview.md), not direct calls.

## What every flavor shares

No matter which base class you pick, you get the same `CoreWebStartup` machinery:

* Layered [configuration](../concepts/configuration.md)
* JWT [authentication and authorization](../concepts/authentication-authorization.md)
* [Swagger and OpenAPI](../concepts/swagger.md) with OIDC login
* API and model [versioning](../concepts/versioning.md)
* A `/healthz` health-check endpoint
* `ICurrentUserProvider` for audit attribution

The flavor-specific pages below focus on what's *different*.
