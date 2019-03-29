# Advanced Issues

Here are advanced issues that we may or may not want to solve in the language frontend
after we have a stable language backend.

## A Coin Flipping Example

Let's consider a simple game of coin flipping.

We might want to write it as follows:

```
function trusted_randomness () Players ==> @consensual uint256 {
  for_each {
    let r = random(2**256);
    let @verifiable @public h = hash(r);
    sync ();
    publish r;
    verify h;
    return @consensual reduce (logxor) all_values(r);
  }
}
```

In the above example, `Players` is some kind of typeclass
that provides the notion of there being many players,
as well as the primitives
`for_each` `@verifiable` `@public` `sync` `publish` `verify` and `consensual`.

The `for_each` block marks the algorithm as working similarly
on each of the players in the `Players` pool.

The `@public` attribute works as if `publish h` was called after the definition of `h`
which itself means that `h` will be shared with all other players:
messages will be sent to each of the other players, signed by the player,
encrypted for the recipients, containing an identifier for the current data
(hash of the line of source code, global context frame, etc., including identity of players)
followed by the actual data.
The call to the `sync` macro waits until all published values are received
before proceeding to the next step;
some variant may take a list of variables as parameter,
or the identifier of a scope (representing all the variables within that scope only).

The `verify` primitive
(I would use the term `promise` or `commitment` but they mean something different
in the context of computer science),
remembers the definition of `h` in terms of `r`,
which was marked as `@verifiable`.
Note thta the verification is done by the *other* players,
and if the verification fails, the player who made the false promise is punished:
his name is added to the list of failed players,
who will lose their security deposit in favor of other players —
some global notion of blame offered by the entire `Players` notion.

`@consensual` means that everyone can thereupon verify that
the return value is indeed the result of this computation,
and that a contract can be written based on this answer.
That everyone will indeed get the same answer and that it is verifiable
by the contract should be proven correct by the implementation,
and can be used as part of further verifications:
it must be computable in a deterministic way from information that is itself consensual.

In the end, it can all be translated into a lower-level message exchanges,
targetting a variant of the Pi calculus,
probably closer to the Kell calculus (for locations)
and/or to the Rho calculus (for the digestible reification of computations).

NB: Maybe we should use some variant of the quasiquote and unquote like xapping syntax
for SIMD vs MIMD fragments of code as in the Connection Machine's *Lisp (starlisp) ?
https://pdfs.semanticscholar.org/15cb/2e60fb0dab06dcf3519c22e28f1c5a42c541.pdf
