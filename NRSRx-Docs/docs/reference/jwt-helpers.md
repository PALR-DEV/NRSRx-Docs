---
id: jwt-helpers
title: JWT Helpers
sidebar_label: JWT Helpers
---

# JWT Helpers

`IkeMtz.NRSRx.Core.Jwt` provides utilities for working with JWT tokens **outside of
ASP.NET middleware** — useful in background jobs, console apps, and service-to-service
validation scenarios where you need to validate a bearer token without a full HTTP
pipeline.

## ITokenValidator / TokenValidator

`ITokenValidator` is the contract; `TokenValidator` is the concrete implementation.

```csharp
public interface ITokenValidator
{
  TokenValidationParameters TokenValidationParameters { get; }

  Task InitAsync(string metaDataAddress, string audience);
  Task InitAsync(string metaDataAddress, string issuer, string audience);

  bool ValidateToken(string token);
}
```

### Usage

```csharp
// 1. Create and initialize the validator.
var validator = new TokenValidator();
await validator.InitAsync(
    metaDataAddress: "https://login.example.com/.well-known/openid-configuration",
    audience: "my-service-api");

// 2. Validate a token (e.g., received from a caller or a message envelope).
bool isValid = validator.ValidateToken(bearerToken);
```

`InitAsync` fetches the identity provider's OpenID Connect configuration (including
signing keys) via the metadata address. Signing keys are refreshed automatically every
15 minutes. Call `InitAsync` once at startup, not on every validation.

### InitAsync overloads

| Overload | When to use |
| --- | --- |
| `InitAsync(metaDataAddress, audience)` | The issuer is discovered from the OIDC metadata (recommended). |
| `InitAsync(metaDataAddress, issuer, audience)` | You need to pin the issuer explicitly rather than discovering it. |

Multiple audiences can be passed as a comma-separated string:

```csharp
await validator.InitAsync(metaDataAddress, "audience1,audience2");
```

### What ValidateToken checks

`TokenValidator.ValidateToken` runs a strict validation:

| Check | Enabled |
| --- | --- |
| Issuer | ✅ |
| Audience | ✅ |
| Issuer signing key | ✅ |
| Lifetime (not expired) | ✅ |
| Token replay | ✅ |
| Actor | ✅ |

Returns `true` if the token passes all checks. Throws `SecurityTokenException` subtypes
on validation failure (expired, invalid signature, wrong audience, etc.).

### Example: validating tokens in a job

```csharp
public class Program : JobBase<Program>, IJob
{
  private ITokenValidator _tokenValidator;

  public override async Task RunAsync()
  {
    _tokenValidator = new TokenValidator();
    await _tokenValidator.InitAsync(
        Configuration.GetValue<string>("IdentityProvider") + ".well-known/openid-configuration",
        Configuration.GetValue<string>("IdentityAudiences"));
    await base.RunAsync();
  }
}

public class MyFunction : IFunction
{
  private readonly ITokenValidator _tokenValidator;

  public override Task<bool> HandleMessageAsync(MyMessage msg)
  {
    // Validate a token included in the message envelope.
    if (!_tokenValidator.ValidateToken(msg.BearerToken))
      return Task.FromResult(false);
    // ...
    return Task.FromResult(true);
  }
}
```

### Dependency injection

Register `TokenValidator` as a singleton (it maintains signing-key state):

```csharp
services.AddSingleton<ITokenValidator, TokenValidator>();

// Then initialize it:
var validator = serviceProvider.GetRequiredService<ITokenValidator>();
await validator.InitAsync(metaDataAddress, audience);
```

---

## EpochDateConverter

A static utility for converting between `DateTime` and Unix epoch time (seconds since
1970-01-01 UTC). Useful when working with JWT claims like `iat`, `exp`, and `nbf`, which
are expressed as epoch integers.

```csharp
public static class EpochDateConverter
{
  public static readonly DateTime Epoch; // 1970-01-01T00:00:00Z

  public static DateTime FromDouble(double value);  // epoch seconds → DateTime
  public static double   ToDouble(DateTime value);  // DateTime → epoch seconds
}
```

```csharp
// Convert an "exp" claim value to a readable DateTime.
var expClaim = token.Claims.FirstOrDefault(c => c.Type == "exp");
if (expClaim != null)
{
  var expiry = EpochDateConverter.FromDouble(double.Parse(expClaim.Value));
  Console.WriteLine($"Token expires at: {expiry:u}");
}

// Convert a DateTime to epoch for building a custom JWT payload.
var issuedAt = EpochDateConverter.ToDouble(DateTime.UtcNow);
```

---

## Package

```xml
<PackageReference Include="IkeMtz.NRSRx.Core.Jwt" Version="*" />
```

This package targets `netstandard2.1` and can be used in any .NET 5+ project.
