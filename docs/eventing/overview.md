---
id: overview
title: Eventing Overview
sidebar_label: Overview
---

# Eventing Overview

NRSRx is built for **event-driven microservices**. Rather than having one service call
another synchronously (which couples them and creates cascading failures), services
communicate by **publishing events** to a message bus that other services **subscribe** to.

## The golden rule

> At all costs, avoid having one microservice be dependent on another. Each microservice
> should maintain a copy of any cross-domain data necessary to complete its work. Updates
> to this cross-domain data should be communicated via an event bus.

So in NRSRx, the flow looks like this:

```
┌────────────────┐      publishes        ┌──────────────┐     subscribes      ┌────────────────┐
│  Schools API   │ ── SchoolUpdated ───► │  Message Bus │ ──────────────────► │  Students Job  │
│  (WebApi)      │                       │ Redis / ASB  │                     │  (subscriber)  │
└────────────────┘                       └──────────────┘                     └────────────────┘
                                                                                       │
                                                                          updates its local copy
                                                                          of cross-domain data
```

The Schools service doesn't know or care who consumes `SchoolUpdated`. The Students service
keeps its own copy of the school data it needs, updated via events, so it can do its job
even if the Schools service is down.

## Two transports

NRSRx supports two message bus technologies behind the same publishing abstraction:

| Transport | Publisher package | Subscriber package |
| --- | --- | --- |
| **Redis Streams** | `IkeMtz.NRSRx.Events.Publishers.Redis` | `IkeMtz.NRSRx.Events.Subscribers.Redis` |
| **Azure Service Bus** | `IkeMtz.NRSRx.Events.Publishers.ServiceBus` | Azure SDK (`Azure.Messaging.ServiceBus`) |

Both implement the same `IPublisher<TEntity, TEvent>` contract from
`IkeMtz.NRSRx.Events.Abstraction`, so your controller code is identical regardless of
transport. You swap the registration in `Startup`, not your business logic.

:::note Azure Service Bus subscribers
NRSRx ships a first-class ASB **publisher** (`AddServiceBusQueuePublishers<T>`), but the
subscriber side uses the Azure SDK's `ServiceBusProcessor` directly — there is no
`IkeMtz.NRSRx.Events.Subscribers.ServiceBus` package. See
[Jobs & Subscribers](./jobs.md) for the Redis subscriber pattern (the Azure SDK equivalent
follows the same `HandleMessageAsync` → ack flow, just with a different processor type).
:::

### Choosing a transport

| | Redis Streams | Azure Service Bus |
| --- | --- | --- |
| **Best for** | Self-hosted, on-prem, and local dev | Azure-native, enterprise production |
| **Infrastructure** | A single Redis instance or cluster | Azure namespace (managed by Microsoft) |
| **Replay / history** | Streams retain all messages until trimmed | Standard queues are destructive; topics retain for TTL |
| **Dead-letter** | Manual (implement your own DLQ) | Built-in dead-letter queue |
| **Consumer groups** | Redis consumer groups, built in | Topics + subscriptions |
| **Cost** | Redis hosting only | Per-operation Azure billing |
| **NRSRx subscriber** | `RedisStreamSubscriber<T, TEvent>` | Azure SDK `ServiceBusProcessor` |

**When in doubt:** start with Redis (faster inner loop, no cloud account required). Switch
to Azure Service Bus when you need managed infrastructure, guaranteed delivery SLAs, or
dead-letter handling out of the box.

## Events are entity plus verb

An event in NRSRx is the pairing of **an entity** with **an event type** (a verb). The
event types live in `IkeMtz.NRSRx.Events.Abstraction`:

| Imperative (command) | Past tense (notification) |
| --- | --- |
| `CreateEvent` | `CreatedEvent` |
| `UpdateEvent` | `UpdatedEvent` |
| `DeleteEvent` | `DeletedEvent` |
| `SendEvent` | `SentEvent` |
| (none) | `ReceivedEvent` |

Each carries an `EventSuffix` (for example `"Created"`). NRSRx composes the stream or topic
name from the entity name plus the suffix, so a `School` paired with `CreatedEvent` flows on
a `SchoolCreated` stream. Choosing imperative versus past-tense lets you model both
*commands* ("please create this") and *notifications* ("this was created").

## The two halves

Eventing has a publish side and a subscribe side, each documented separately:

* **[Publishers](./publishers.md)** covers how a service emits events
  (`IPublisher<TEntity, TEvent>`).
* **[Jobs & Subscribers](./jobs.md)** covers how a background worker consumes events
  (`MessageFunction` plus `JobBase`).

## Why this matters

* **Resilience.** A consumer being down doesn't break the producer; messages wait.
* **Scalability.** Consumers scale independently of producers.
* **Decoupling.** Services evolve on their own schedules, and new consumers can be added
  without touching the producer.
* **Single-writer integrity.** Combined with the guideline that *each table is written by
  exactly one service*, eventing keeps data ownership clean.
