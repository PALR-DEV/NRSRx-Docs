---
id: test-helpers-reference
title: Test Helpers Reference
sidebar_label: Test Helpers Reference
---

# Test Helpers Reference

A complete listing of every helper class and method in `IkeMtz.NRSRx.Core.Unigration`,
`IkeMtz.NRSRx.Jobs.Unigration`, and `IkeMtz.NRSRx.Unigration.Logging`.

For the full unigration testing guide see [Unigration Testing](./unigration.md).

---

## BaseUnigrationTests

Base class for all unigration test classes. Inherit from this in your `[TestClass]`.

| Member | Purpose |
| --- | --- |
| `TestContext` | MSTest's `TestContext`. Wire it up with the `[TestInitialize]` property setter pattern. |
| `TestWebHostBuilder<TSiteStartup, TTestStartup>()` | Creates an `IWebHostBuilder` that runs your real startup inside a test override. Sets `ASPNETCORE_ENVIRONMENT=Development`. |
| `GenerateTestToken(claims?)` | Mints a signed (but not signature-validated by the test server) JWT with standard claims (`sub`, `email`, `aud`, `iss`). |
| `GenerateTestToken(Action<ICollection<Claim>>)` | Same, but lets you add or modify claims before the token is signed. |
| `GenerateTokenAsync()` | Obtains a real token from an identity server using `IntegrationTestClientId`/`ClientSecret`/`TokenUrl` config keys. Used in integration tests. |
| `GenerateAuthHeader(client, token)` | Sets `client.DefaultRequestHeaders.Authorization` to `Bearer {token}`. |
| `ExecuteOnContext<TDbContext>(services, callback)` | Seeds the in-memory database: calls `EnsureCreated()`, invokes `callback(db)`, then `SaveChanges()`. |
| `DeserializeResponseAsync<T>(response)` | Reads the response body and deserializes using NRSRx's `JsonSerializerSettings`. |
| `JsonClone<T>(source)` | Deep-copies an object via JSON round-trip using NRSRx's settings. |

---

## TestServerExtensions

Extension methods on `TestServer`.

| Method | Purpose |
| --- | --- |
| `srv.GetDbContext<TContext>()` | Returns the in-memory DbContext from the test server's service provider. Use for post-request database assertions. |
| `srv.GetTestService<TServiceType>()` | Returns any registered service from the test server. |
| `srv.GetTestService<TServiceType, TImplementationType>()` | Returns a service cast to a specific implementation type. |

---

## CoreTestServerExtensions

Extension methods for building test infrastructure.

| Method | Purpose |
| --- | --- |
| `srv.CreateClient(TestContext)` | Creates an `HttpClient` whose requests and responses are logged to the MSTest output via `HttpClientLoggingHandler`. |
| `srv.BuildSignalrConnection(hubEndpoint, accessToken)` | Creates a `HubConnection` client connected to the test server's SignalR hub. |
| `SetupTestAuthentication(builder, config, testContext)` | Configures JWT bearer to accept unsigned test tokens. Called automatically by `CoreWebApiUnigrationTestStartup`. |
| `SetupTestDbContext<TDbContext>(services)` | Replaces the production DbContext with an in-memory EF provider. Called automatically by `CoreWebApiUnigrationTestStartup`. |

---

## Test Startup Classes

Each flavor has a pair of test startup classes:

| Class | Use for |
| --- | --- |
| `CoreWebApiUnigrationTestStartup<TStartup>` | WebApi unigration tests (in-memory auth + in-memory DB). |
| `CoreWebApiTestStartup<TStartup>` | WebApi integration tests (real identity server, real DB). |
| `CoreWebApiIntegrationTestStartup<TStartup>` | WebApi integration tests against a containerized DB. |
| `CoreODataUnigrationTestStartup<TStartup>` | OData unigration tests. |
| `CoreODataTestStartup<TStartup>` | OData integration tests. |
| `CoreODataIntegrationTestStartup<TStartup>` | OData integration tests against a containerized DB. |
| `CoreSignalrUnigrationTestStartup<TStartup>` | SignalR unigration tests. |

---

## PublisherUnigrationTester

Replaces real event publishers (Redis/Service Bus) with Moq-backed mocks that capture
published entities in lists. Use it in `ConfigureTestServices` to register the mocks:

```csharp
var publisherTester = new PublisherUnigrationTester<School, School>();

using var srv = new TestServer(
    TestWebHostBuilder<Startup, CoreWebApiUnigrationTestStartup<Startup>>()
        .ConfigureTestServices(services =>
            publisherTester.RegisterDependencies(services)));
```

After your request, assert on the captured lists:

| Property | Captured from |
| --- | --- |
| `publisherTester.CreateList` | `IPublisher<TEntity, CreateEvent>` calls |
| `publisherTester.CreatedList` | `IPublisher<TEntity, CreatedEvent>` calls |
| `publisherTester.UpdatedList` | `IPublisher<TEntity, UpdatedEvent>` calls |
| `publisherTester.DeletedList` | `IPublisher<TEntity, DeletedEvent>` calls |

---

## TestDataFactory

Generates randomized but structurally valid test data.

| Method | Purpose |
| --- | --- |
| `CreateIdentifiable<TEntity>()` | Creates a new instance of `TEntity` (must implement `IIdentifiable<Guid>`) with `Id = Guid.NewGuid()`. |
| `CreateIdentifiable<TEntity, TIdentityType>()` | Same, but for a custom key type. |
| `StringGenerator(maxLength, allowSpaces?, characterSet?)` | Generates a random string of up to `maxLength` characters. `allowSpaces: true` inserts word-like spaces. |
| `InjectSpaces(length, random, sb, characterSet)` | Injects spaces into a `StringBuilder` at word-boundary intervals. |

```csharp
var course  = TestDataFactory.CreateIdentifiable<Course>();
var title   = TestDataFactory.StringGenerator(50, allowSpaces: true);
var code    = TestDataFactory.StringGenerator(8);  // no spaces
```

---

## SnapshotAsserter

Line-by-line snapshot comparison for OData query results:

```csharp
var actual   = await response.Content.ReadAsStringAsync();
var expected = File.ReadAllText("Snapshots/courses_filter.json");
SnapshotAsserter.AssertEachLineIsEqual(expected, actual);
```

`AssertEachLineIsEqual` trims each line before comparing, so insignificant whitespace
differences (e.g., trailing spaces) don't cause spurious failures.

---

## SwaggerUnitTests

Helpers for verifying that the Swagger UI and JSON document are generated correctly:

```csharp
await SwaggerUnitTests.TestHtmlPageAsync(srv);               // verifies the HTML page loads
await SwaggerUnitTests.TestJsonDocAsync(srv);                // verifies the OpenAPI JSON is valid
await SwaggerUnitTests.TestReverseProxyJsonDocAsync(srv);    // verifies paths under a gateway prefix
```

Add these three tests to every NRSRx service to catch Swagger misconfiguration early.

---

## Fakes

Located in `IkeMtz.NRSRx.Core.Unigration.Fakes`.

### FakeTimeProvider

Controls the clock in tests. Inject it into anything that depends on `TimeProvider`
(including `CronFunction` and `FileCronJobStateProvider`):

```csharp
var fakeTime = new FakeTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
// fakeTime.GetUtcNow() always returns 2026-01-01T00:00:00Z
```

### FakeLogger

A non-generic `ILogger` implementation that records every call for assertion:

```csharp
var fakeLogger = new FakeLogger();
var service = new MyService(fakeLogger);
// Each entry is a (LogLevel LogLevel, string State) tuple:
Assert.IsTrue(fakeLogger.Logs.Any(l => l.LogLevel == LogLevel.Error));
```

### FakeHttpMessageHandler

Substitutes for `HttpClient`'s transport to return canned responses. You supply a
`ResponseLogic` function, and two static factories cover the common cases:

```csharp
// Build an HttpClient that answers every request with a canned JSON body:
var client = FakeHttpMessageHandler.FakeHttpClientFactory(request =>
    FakeHttpMessageHandler.HttpJsonResponseFactory(new { id = 1 }));

// Or construct the handler yourself and vary the response per request:
var handler = new FakeHttpMessageHandler
{
  ResponseLogic = request => request.RequestUri.AbsolutePath.Contains("missing")
      ? new HttpResponseMessage(HttpStatusCode.NotFound)
      : FakeHttpMessageHandler.HttpJsonResponseFactory(new { id = 1 }),
};
```

---

## More helpers

### HttpClientExtensions

`PostAsJsonAsync<T>` / `PutAsJsonAsync<T>` extensions on `HttpClient` that serialize the
body with NRSRx's `JsonSerializerSettings` (camelCase, ignore reference loops) — these are
what the unigration examples use, not the `System.Net.Http.Json` versions.

### MockHttpContextAccessorFactory

`CreateAccessor()` returns an `IHttpContextAccessor` whose user is authenticated as
`MockHttpContextAccessorFactory.TestUser` (default `"NRSRx Test User"`) — handy for unit
testing anything that takes `HttpUserProvider`.

### MockRedisStreamFactory (Events namespace)

Moq factories for eventing tests without a real Redis:

| Method | Returns |
| --- | --- |
| `MockRedisStreamFactory.CreateMockConnection()` | `(Mock<IConnectionMultiplexer>, Mock<IDatabase>)` pair. |
| `MockRedisStreamFactory<TEntity, TEvent, TId>.CreatePublisher()` | A `Mock<IPublisher<…>>`. |
| `MockRedisStreamFactory<TEntity, TEvent, TId>.CreateSubscriber(collection?)` | A mocked `RedisStreamSubscriber` that serves the given entities as messages. |

### SplitMessageFactory (Events namespace)

`SplitMessageFactory<TEntity>.Create(entityFactory, messageCount, taskName, userName)`
builds a batch of `SplitMessage<TEntity>` instances for testing split-message functions.

### DbContextFactory & LinqExtensions (Data namespace)

| Method | Purpose |
| --- | --- |
| `DbContextFactory.CreateInMemoryAuditableDbContext<T>(testContext)` | New in-memory `AuditableDbContext` (with `SystemUserProvider`) for pure unit tests. |
| `DbContextFactory.CreateInMemoryDbContext<T>(testContext)` | Same for a plain `DbContext`. |
| `queryable.RandomAsync()` | Returns a random record from an `IQueryable` — useful for picking seeded rows. |

The `Data` namespace also holds `AuditableTestInterceptor` and
`CalculatableTestInterceptor` — EF save interceptors that stamp `IAuditable` fields and
run `ICalculateable.CalculateValues()` for test contexts that are *not*
`AuditableDbContext` (wired automatically by `SetupTestDbContext`).

### ControllerFactory & TestingObjectValidator (WebApi.Unit namespace)

For plain **unit** tests of a controller (no test server):
`ControllerFactory<TController>.Create(args...)` news up the controller with a
`ControllerContext`, default HTTP context, and a `TestingObjectValidator` so
`TryValidateModel` (and therefore `[ValidateModel]`-style code paths) work outside the
MVC pipeline.

### CharacterSets

String constants for `TestDataFactory.StringGenerator`: `AlphaChars`, `UpperCase`,
`LowerCase`, `Numeric`, `Special`, and combinations.

### TestCategories

MSTest category constants: `Unit`, `Integration`, `Functional`, `Unigration` — use with
`[TestCategory(TestCategories.Unigration)]` so CI can filter test runs.

### TestContextRequestLoggerMiddleware / TestContextResponseLoggerAttribute

Server-side counterparts to `HttpClientLoggingHandler`: middleware
(`app.UseTestContextRequestLogger(testContext)`) and an action filter that log incoming
requests and outgoing responses to the MSTest output. The unigration test startups wire
these for you.

---

## Jobs.Unigration

Located in `IkeMtz.NRSRx.Jobs.Unigration`.

### MockCronJobStateProvider

A Moq-backed `ICronJobStateProvider` that always returns a state where `NextRunDateTimeUtc`
is yesterday — guaranteeing the cron function is always due to run in tests:

```csharp
var fakeTime  = new FakeTimeProvider(DateTimeOffset.UtcNow);
var mockState = new MockCronJobStateProvider(fakeTime);
// mockState returns: LastRunDateTimeUtc = 180 days ago, NextRunDateTimeUtc = yesterday
```

Access the underlying `Mock<ICronJobStateProvider>` via `mockState.Mock` for further setup.

### Job test base classes

| Class | Use for |
| --- | --- |
| `CoreUnigrationTestJob<TProgram>` | In-memory job test. |
| `CoreMessagingUnigrationTestJob<TProgram>` | In-memory job with fake message delivery. |
| `CoreIntegrationTestJob<TProgram>` | Real Redis / real DB. |
| `CoreMessagingIntegrationTestJob<TProgram>` | Real Redis with real message delivery. |

---

## Unigration.Logging

Located in `IkeMtz.NRSRx.Unigration.Logging`. Wired automatically by `TestWebHostBuilder`
and `srv.CreateClient(TestContext)`.

| Class | Purpose |
| --- | --- |
| `TestContextLogger` | An `ILogger` implementation that writes to `TestContext.WriteLine`. |
| `TestContextLoggerProvider` | Provides `TestContextLogger` instances to the DI container. |
| `TestContextLoggerExtensions` | `.AddTestContext(TestContext)` extension for `ILoggingBuilder`. |
| `TestContextOperationScope` | Wraps `ILogger` scopes so scope properties appear in the test output. |
| `HttpClientLoggingHandler` | A `DelegatingHandler` that logs every outbound HTTP request and response to the test output. |
