# Declarative assertions

The `assertions` array on a declaration carries business-logic checks
that run post-response. Each entry is a single line in a small,
typed DSL:

```
<target>  <operator>  [<operand>]
```

Twenty operators across five families. No code, no eval, no string
interpolation gymnastics. Pure, deterministic, no-throw evaluation.

---

## Quick example

```json
"assertions": [
  "response.body.id is_uuid_v4",
  "response.body.email equals request.body.email",
  "response.body.created_at is_recent_timestamp",
  "response.body.items count_greater_than 0",
  "response.status in_range 200 .. 299",
  "db.primary_postgres.user_check.count_equals 1"
]
```

Each line generates one `assertion`-marker case in the test plan,
reported independently in the run output.

---

## The grammar in detail

```
<target>      ::= <root>[.<segment>]*
<root>        ::= "request" | "response" | "db"
<operator>    ::= one of the 20 names below
<operand>     ::= <literal> | <target-ref> | <regex-literal> | <range>
```

- The whole assertion is one line; whitespace separates tokens.
- The operand is **omitted entirely** for nullary operators (`exists`,
  `is_uuid_v4`, etc.).
- String literals are quoted with single or double quotes
  (`"hello"` or `'hello'`).
- Number literals are bare (`42`, `3.14`).
- Boolean literals are bare (`true`, `false`).
- Regex literals use forward-slash delimiters (`/pattern/flags`).
- Range operands use the `..` separator (`200 .. 299`).

---

## Target paths

| Target | What it resolves to |
|---|---|
| `request.url` | the full resolved URL of the outgoing request |
| `request.headers.<name>` | one header value sent in the request |
| `request.body.<path>` | a value inside the request body (dot- and bracket-indexable) |
| `response.status` | the integer HTTP status code |
| `response.time_ms` | the integer response time in milliseconds |
| `response.headers.<name>` | one header value received in the response |
| `response.body.<path>` | a value inside the response body |
| `db.<connection>.<query_id>.<column>` | a value from a `db_verify` query result |

Body and headers paths support dot-and-bracket indexing:
`response.body.items[0].name`, `response.body.data.user.email`.

The `db.<connection>.<query_id>.<column>` form requires that the
endpoint has a `db_verify` block with `connection` and `query_id`
fields matching the path — see [db-verify.md](./db-verify.md).

**Unrecognised roots** (anything other than `request`, `response`, `db`)
fail at parse time. So a bareword that looks like a target —
`response.body.name equals THIS_IS_NOT_THE_NAME` — would error
("Unknown root 'THIS_IS_NOT_THE_NAME'") because `THIS_IS_NOT_THE_NAME`
is parsed as a target path with an unknown root. Quote string literals
that look like identifiers: `equals "THIS_IS_NOT_THE_NAME"`.

---

## The 20 operators

### Comparison family (5)

| Operator | Operand shape | Example |
|---|---|---|
| `equals` | literal or target-ref | `response.body.version equals "3.0.6"` |
| `not_equals` | literal or target-ref | `response.body.status not_equals "error"` |
| `greater_than` | literal or target-ref | `response.status greater_than 199` |
| `less_than` | literal or target-ref | `response.body.age less_than 100` |
| `in_range` | two numeric bounds `lo .. hi` | `response.status in_range 200 .. 299` |

Comparison operators accept arithmetic expressions on the RHS for
numeric comparisons:

```
response.body.total equals (request.body.qty * request.body.unit_price)
```

### Pattern family (4)

| Operator | Operand shape | Example |
|---|---|---|
| `matches` | regex literal `/pattern/flags` | `response.body.version matches /^3\.0\.\d+$/` |
| `contains` | string literal | `response.body.url contains "example.com"` |
| `starts_with` | string literal | `response.body.token starts_with "sk_live_"` |
| `ends_with` | string literal | `response.body.email ends_with "@example.com"` |

Regex flags are restricted to `i`, `m`, `s`, `u` (the whitelisted set);
duplicates and unknown flags are rejected at parse time.

### Existence family (4)

| Operator | Operand shape | Example |
|---|---|---|
| `exists` | none | `response.body.email exists` |
| `not_exists` | none | `response.body.error not_exists` |
| `is_null` | none | `response.body.deleted_at is_null` |
| `is_not_null` | none | `response.body.name is_not_null` |

- `exists` is true iff the path resolves to a defined value (including
  `null`).
- `is_null` is true iff the path resolves to literal `null`.
- A missing path returns "not found" — `exists` is false, `not_exists`
  is true.

### Type / format family (5)

All nullary. Apply the named validator to the target value.

| Operator | True when |
|---|---|
| `is_uuid_v4` | the value is a string matching the UUID v4 pattern (xxxxxxxx-xxxx-4xxx-Yxxx-xxxxxxxxxxxx where Y ∈ {8,9,a,b}) |
| `is_iso_timestamp` | the value is a string parseable as an ISO-8601 timestamp |
| `is_recent_timestamp` | the value is a string parseable as an ISO-8601 timestamp within the last hour |
| `is_email` | the value is a string matching a permissive email regex |
| `is_url` | the value is a string parseable as a URL with a scheme + host |

Examples:

```
response.body.id is_uuid_v4
response.body.created_at is_iso_timestamp
response.body.created_at is_recent_timestamp
response.body.contact_email is_email
response.body.homepage is_url
```

### Aggregate family (2)

For paths that resolve to arrays — counts the elements.

| Operator | Operand | Example |
|---|---|---|
| `count_equals` | numeric literal | `response.body.items count_equals 5` |
| `count_greater_than` | numeric literal | `response.body.results count_greater_than 0` |

Applies only when the target resolves to an array; on a non-array it
fails with a type-mismatch reason.

---

## Cross-target assertions

The RHS of comparison operators can be another target path, not just a
literal. Lets you assert relationships between request, response, and
db state:

```json
"assertions": [
  "response.body.email equals request.body.email",
  "response.body.user_id equals db.primary_postgres.user_lookup.id",
  "response.body.total equals (response.body.qty * response.body.unit_price)"
]
```

This is how you verify "the API returned the same email the client
sent" (caller→callee) and "the DB row matches what the API returned"
(API→database) without writing code.

---

## Literal value syntax

| Type | How to write it |
|---|---|
| String | `"hello"` or `'hello'` (matching quotes). Bareword strings without `"`/`'` may be parsed as a target-ref, so always quote |
| Number | `42`, `3.14`, `-1`, `0` |
| Boolean | `true` or `false` |
| null | `null` (only meaningful as an `equals` operand; otherwise use `is_null`) |
| Regex | `/pattern/flags` — flags ∈ `i m s u` |
| Range | `lo .. hi` (two numbers separated by `..`) |

---

## Failure reasons

When an assertion fails, the run report records a structured failure
reason. The common codes:

| Failure code | Meaning |
|---|---|
| `COMPARISON_FAILED` | `equals` / `greater_than` / etc. — the actual value did not satisfy the expected comparison |
| `REGEX_NO_MATCH` | `matches` — the regex did not match the target |
| `TARGET_NOT_FOUND` | the target path resolved to "not found" (caught by `exists`/`not_exists` rather than failing the assertion outright) |
| `FORMAT_INVALID` | `is_uuid_v4` / `is_email` / etc. — the value failed the format check |
| `AGGREGATE_MISMATCH` | `count_equals` / `count_greater_than` — the count did not satisfy the operator |
| `TYPE_MISMATCH` | the target was the wrong type for the operator (e.g. `count_*` on a non-array) |

You see these in the report's `attempts[].assertions[].failureCode`
field.

---

## Where assertions cannot help

The DSL is intentionally limited. It does **not** support:

- **Function calls / custom predicates.** No user-defined `isMyShape(x)`.
- **String/numeric transforms.** No `response.body.email.toLowerCase()`.
- **Conditional logic.** No "if X then assert Y".
- **Multi-line scripts.** Each assertion is one line.

If you need any of the above, the assertion belongs in a hand-written
integration test, not in APIWright. The catalog + assertions handle the
~85 % of commodity coverage; the bespoke 15 % stays in integration tests.
See [comparisons.md](./comparisons.md).

---

## Performance

Assertions are evaluated entirely in process after the response is
received. Cost is microseconds per assertion. There's no practical
limit to how many assertions you can declare per endpoint; 20+ on one
endpoint is fine.

---

## See also

- [test-catalog.md](./test-catalog.md) — how `assertion` cases fit into
  the broader catalog.
- [db-verify.md](./db-verify.md) — for `db.<connection>.<query_id>.*`
  target paths.
- [canonical-model.md](./canonical-model.md) — the full declaration
  schema including the `assertions` array placement.
