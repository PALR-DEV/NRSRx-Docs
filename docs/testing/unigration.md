---
id: unigration
title: Unigration Testing
sidebar_label: Unigration Testing
---

# Unigration Testing

NRSRx coins the term **"Unigration"** — a blend of *unit* and *integration* testing. The
idea: spin up your **whole service in-process** (the real startup pipeline, real
controllers, real EF with an in-memory database, fakes for external dependencies) and
exercise it through HTTP, so a single test covers routing, model binding, validation, auth,
mapping, and persistence all at once.

This is how NRSRx services routinely reach **95%+ code coverage** with a manageable number
of tests.

- **Web package:** `IkeMtz.NRSRx.Core.Unigration`
- **Jobs package:** `IkeMtz.NRSRx.Jobs.Unigration`
- **Logging:** `IkeMtz.NRSRx.Unigration.Logging`
- **Test framework:** MSTest

## How it works

```
A normal unit test:        controller method only (mocks for everything)
A normal integration test: deploy to a real server + real DB (slow, flaky)

Unigration:                real ASP.NET pipeline in memory
                           + in-memory EF database
                           + fakes for auth / external dependencies
                           → fast like a unit test, broad like an integration test
```

`IkeMtz.NRSRx.Core.Unigration` provides base classes and helpers (under namespaces
`WebApi`, `OData`, `SignalR`, `Events`, `Data`, `Fakes`, and `Swagger`) that:

- Build a `TestServer` from your real `Startup`
- Swap the JWT middleware for a test-friendly alternative that accepts unsigned tokens
- Replace your database with an in-memory EF provider
- Hand you helpers to seed data, generate tokens, make HTTP calls, and assert results

## The two startup types

Every unigration test uses **two** startup classes:

| Class | Role |
| --- | --- |
| Your real `Startup` | The production startup. Not modified. |
| A test startup (e.g. `CoreWebApiUnigrationTestStartup<TStartup>`) | Wraps your real `Startup`, overrides `SetupAuthentication` to accept test tokens, and wires the in-memory DB. |

`CoreWebApiUnigrationTestStartup<TStartup>` is the typical choice for WebApi services.
It overrides `SetupAuthentication` to call `builder.SetupTestAuthentication(Configuration, TestContext)`,
which accepts any JWT regardless of signature — so `GenerateTestToken()` produces tokens
the server will accept.

For OData services use `CoreODataUnigrationTestStartup<TStartup>`; for SignalR use
`CoreSignalrUnigrationTestStartup<TStartup>`.

## A complete WebApi test

```csharp
using System;
using System.Net;
using System.Threading.Tasks;
using IkeMtz.NRSRx.Core.Unigration;
using IkeMtz.NRSRx.Core.Unigration.WebApi;
using Microsoft.AspNetCore.TestHost;
using Microsoft.VisualStudio.TestTools.UnitTesting;

[TestClass]
public class CoursesControllerTests : BaseUnigrationTests
{
    [TestMethod]
    [TestCategory(TestCategories.Unigration)]
    public async Task Post_CreatesCourse()
    {
        // 1. Build the test server from the real Startup + the unigration test startup.
        using var srv = new TestServer(
            TestWebHostBuilder<Startup, CoreWebApiUnigrationTestStartup<Startup>>());

        // 2. Seed the in-memory database before the request.
        ExecuteOnContext<DatabaseContext>(srv.Services, db =>
        {
            db.Schools.Add(new School { Id = Guid.NewGuid(), Name = "Test School" });
        });

        // 3. Create an authenticated HTTP client.
        var client = srv.CreateClient(TestContext);
        GenerateAuthHeader(client, GenerateTestToken());

        // 4. Build the request payload.
        var request = new CourseUpsertRequest
        {
            Id   = Guid.NewGuid(),
            Title = TestDataFactory.StringGenerator(20, allowSpaces: true),
        };

        // 5. Hit the real endpoint through HTTP.
        var response = await client.PostAsJsonAsync("api/v1/Courses.json", request);

        // 6. Assert: the full pipeline ran — routing, validation, mapping, auditing, save.
        response.EnsureSuccessStatusCode();
        var created = await DeserializeResponseAsync<Course>(response);
        Assert.AreEqual(request.Title, created.Title);
        Assert.IsNotNull(created.CreatedBy);    // AuditableDbContext stamped it
        Assert.IsNotNull(created.CreatedOnUtc); // and the timestamp too

        // 7. Assert directly against the database.
        var db = srv.GetDbContext<DatabaseContext>();
        Assert.AreEqual(1, await db.Courses.CountAsync());
    }
}
```

### Key calls explained

| Call | What it does |
| --- | --- |
| `TestWebHostBuilder<TSiteStartup, TTestStartup>()` | Creates a `IWebHostBuilder` backed by your real startup and the test override. Sets `ASPNETCORE_ENVIRONMENT=Development`. |
| `ExecuteOnContext<TDbContext>(services, callback)` | Seeds the in-memory database before the request. Calls `EnsureCreated()` and `SaveChanges()` automatically. |
| `srv.CreateClient(TestContext)` | Creates an `HttpClient` whose responses are logged to the MSTest output via `HttpClientLoggingHandler`. |
| `GenerateTestToken()` | Mints a signed-but-not-validated JWT with standard test claims (`sub`, `email`, `aud`). |
| `GenerateAuthHeader(client, token)` | Sets `client.DefaultRequestHeaders.Authorization` to `Bearer {token}`. |
| `DeserializeResponseAsync<T>(response)` | Reads the response body and deserializes it using NRSRx's `JsonSerializerSettings`. |
| `srv.GetDbContext<TDbContext>()` | Returns the in-memory DbContext so you can make post-request database assertions. |

## Adding custom claims to the test token

Pass an `Action<ICollection<Claim>>` to `GenerateTestToken` to inject extra claims:

```csharp
var token = GenerateTestToken(claims =>
{
    claims.Add(new Claim("permissions", "courses:write"));
    claims.Add(new Claim("role", "Administrator"));
});
GenerateAuthHeader(client, token);
```

## Testing event publishers with PublisherUnigrationTester

For controllers that inject `IPublisher<TEntity, TEvent>`, use `PublisherUnigrationTester`
to capture the published entities without a real Redis or Service Bus:

```csharp
[TestMethod]
public async Task Post_PublishesCreatedEvent()
{
    var publisherTester = new PublisherUnigrationTester<School, School>();

    using var srv = new TestServer(
        TestWebHostBuilder<Startup, CoreWebApiUnigrationTestStartup<Startup>>()
            .ConfigureTestServices(services =>
            {
                // Replace real publishers with mocks that capture calls.
                publisherTester.RegisterDependencies(services);
            }));

    var client = srv.CreateClient(TestContext);
    GenerateAuthHeader(client, GenerateTestToken());

    var response = await client.PostAsJsonAsync("api/v1/Schools.json",
        new SchoolUpsertRequest { Id = Guid.NewGuid(), Name = "Westbrook" });

    response.EnsureSuccessStatusCode();

    // Assert that PublishAsync was called with the right entity.
    Assert.AreEqual(1, publisherTester.CreatedList.Count);
    Assert.AreEqual("Westbrook", publisherTester.CreatedList[0].Name);
}
```

`PublisherUnigrationTester<TEntity, TMessageType>` sets up Moq mocks for all four event
types (`CreateEvent`, `CreatedEvent`, `UpdatedEvent`, `DeletedEvent`) and captures
published entities in `CreateList`, `CreatedList`, `UpdatedList`, and `DeletedList`.

## Testing OData endpoints

OData tests issue queries with `$filter`, `$select`, `$expand`, and assert on the
`ODataEnvelope<T, TKey>` response shape. Use `CoreODataUnigrationTestStartup<TStartup>`:

```csharp
[TestMethod]
public async Task Get_FiltersByTitle()
{
    using var srv = new TestServer(
        TestWebHostBuilder<Startup, CoreODataUnigrationTestStartup<Startup>>());

    ExecuteOnContext<DatabaseContext>(srv.Services, db =>
    {
        db.Courses.Add(new Course { Id = Guid.NewGuid(), Title = "Algebra" });
        db.Courses.Add(new Course { Id = Guid.NewGuid(), Title = "Biology" });
    });

    var client = srv.CreateClient(TestContext);
    GenerateAuthHeader(client, GenerateTestToken());

    var response = await client.GetAsync("odata/v1/Courses?$filter=Title eq 'Algebra'");
    response.EnsureSuccessStatusCode();

    var envelope = await DeserializeResponseAsync<ODataEnvelope<Course, Guid>>(response);
    Assert.AreEqual(1, envelope.Value.Count());
    Assert.AreEqual("Algebra", envelope.Value.First().Title);
}
```

For snapshot testing of OData query results, use `SnapshotAsserter.AssertEachLineIsEqual`:

```csharp
var actualJson = await response.Content.ReadAsStringAsync();
var expectedJson = File.ReadAllText("Snapshots/courses_filter.json");
SnapshotAsserter.AssertEachLineIsEqual(expectedJson, actualJson);
```

## Testing SignalR hubs

Use `BuildSignalrConnection` to create a test hub client connected through the test server:

```csharp
using var srv = new TestServer(
    TestWebHostBuilder<Startup, CoreSignalrUnigrationTestStartup<Startup>>());

var token = GenerateTestToken();
var connection = srv.BuildSignalrConnection("notificationHub", token);
await connection.StartAsync();

var received = new List<string>();
connection.On<string>("OnMessageReceived", msg => received.Add(msg));

// trigger hub action via HTTP or directly...
Assert.IsTrue(received.Count > 0);
```

## TestDataFactory — generating test entities

`TestDataFactory` (in `IkeMtz.NRSRx.Core.Unigration`) creates randomized but valid
test objects:

```csharp
// Create a new IIdentifiable entity with a fresh Guid Id.
var course = TestDataFactory.CreateIdentifiable<Course>();

// Generate a random string of up to 50 characters with spaces.
var title = TestDataFactory.StringGenerator(50, allowSpaces: true);

// Generate a fixed-length alpha string (no spaces).
var code  = TestDataFactory.StringGenerator(8);
```

`CreateIdentifiable<TEntity>()` requires the entity to implement `IIdentifiable<Guid>`.
It constructs a new instance and sets `Id = Guid.NewGuid()`.

## Testing jobs

`IkeMtz.NRSRx.Jobs.Unigration` provides base classes for job testing:

| Class | Use for |
| --- | --- |
| `CoreUnigrationTestJob<TProgram>` | In-memory job test — no real Redis or DB. |
| `CoreMessagingUnigrationTestJob<TProgram>` | In-memory job with fake Redis message delivery. |
| `CoreIntegrationTestJob<TProgram>` | Real Redis / real DB integration. |
| `CoreMessagingIntegrationTestJob<TProgram>` | Real Redis with real message delivery. |

For testing **cron functions**, inject a `MockCronJobStateProvider` so the function
always believes it's due to run (its `NextRunDateTimeUtc` is set to yesterday), and a
`FakeTimeProvider` to control the current time:

```csharp
[TestMethod]
public async Task NightlyReport_ExecutesSuccessfully()
{
    var fakeTime = new FakeTimeProvider(DateTimeOffset.UtcNow);
    var mockState = new MockCronJobStateProvider(fakeTime);

    var function = new NightlyReportFunction(
        logger: NullLogger<NightlyReportFunction>.Instance,
        timeProvider: fakeTime,
        cronJobStateProvider: mockState);

    var result = await function.RunAsync();
    Assert.IsTrue(result);
}
```

See [Scheduled (Cron) Jobs](../eventing/cron-jobs.md) for the full cron function guide.

## Capturing logs in tests

All test servers created with `srv.CreateClient(TestContext)` automatically log HTTP
requests and responses to the MSTest output window. The `IkeMtz.NRSRx.Unigration.Logging`
package powers this via `HttpClientLoggingHandler` (wraps outbound calls) and
`TestContextLogger` / `TestContextLoggerProvider` (routes `ILogger` output to the test
output). No configuration is needed — it's wired by `TestWebHostBuilder`.

## Why this pays off

- **Confidence** — you test the system the way it actually runs; cross-cutting concerns
  (auditing, auth, validation) are *verified*, not assumed.
- **Speed** — everything is in-process; no deployment, no network.
- **Coverage** — one test touches many layers, which is why 95%+ coverage is realistic.

> Every change to the NRSRx framework itself goes through full unigration and integration
> tests on Azure DevOps pipelines.

## Helper reference

See [Test Helpers Reference](./test-helpers-reference.md) for a complete listing of every
helper class and method in `IkeMtz.NRSRx.Core.Unigration`.
