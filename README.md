# Alacrity

Alacrity is a domain-specific language for trustworthy distributed
applications. It uses a cascading style of verification with
guarantees about program execution, compilation, correctness,
security, and efficiency. It uses a suite of verification methods,
like type theory, theorem proving, model checking, the strand spaces
method, and dynamical system simulation.

The core philosophy of Alacrity is to design a highly constrained
programming language that makes it easy to automatically prove the
structural components of desirable properties about applications and
makes it possible to easily prove the user-specific components of
those properties. This is in contrast to designing an unconstrained
language and providing a novel new proving technique.

### License

This code is being developed as free software by LegiLogic, Inc., for
the sake of Alacris, Ltd., that owns the copyright and publishes the
code.

The Alacrity software is distributed under the GNU Lesser General
Public License, version 2.1. See the file [LICENSE](LICENSE).

### Design and Terminology

In the space of verified distributed software, there are a large
number of terms with similar and overlapping meanings. We use the
following terms in Alacrity:

A **message** is a term generated by a free algebra involving atomic
values (like strings, bytes, numbers, and keys), concatenation, and
encryption. 

We abstract different cryptographic functions as particular kinds of
keys. For example: a symmetric encryption is a key that is its own
decryptor; a one-way hash is encryption with a key that has no
inverse; an asymmetric encryption has a pair of keys that are related
by the `inverse` operation; and so on.

We distinguish messages and patterns that describe those
messages. Patterns represent encryption abstractly, by indicating
which key in an environment is used to encrypt. This means that
_participants_ must declare a pattern and an encryption environment.
Similarly, when concrete bytes are received, they are parsed with
reference to an environment (that contains keys used to decrypt parts
of the message.)

We may express this as a type:

```
MsgPat := Atom Bytes | Concat MsgPat MsgPat | Encrypt MsgPat Var
Msg := (Var -> Key) x MsgPat
Raw := Bytes

write : Msg -> Raw
read  : (Var -> Key) x Raw -> Msg
```

A **blockchain** is a unique ordered list of messages that is
common knowledge and globally authoritative. Alacrity is not a
blockchain; it uses existing blockchains. The minimal API Alacrity
expects from a blockchain is:

```
data Chain = Genesis | Confirmed Raw Chain

current : () -> Chain

post : Raw -> Boolean
```

That is, Alacrity only expects that a blockchain provides the ability
to observe the history of the chain (`current`) and attempt to post a
message to chain (`post`). We refer to this posting process as
*execution*. Some blockchains may in fact provide more functionality
than this, such as the ability for message sequences to observe
properties like balancing and so on. Alacrity implementations (such as
compilers specific to particular blockchains) may make use of these
features, as an optimization, but we intentionally choose a
lowest-common denominator perspective on blockchains.

A **distributed application** is a collection of _participants_ that post
to a _blockchain_ to collaboratively implement some functionality. These
participants agree on a _protocol_.

A **protocol** is the language of _messages_ that the set of
_participants_ in a _distributed application_, as well as an
interpretation of the messages.  By "interpretation of the messages",
we mean an abstract type that represents the meaning of the chain. For
example, this type might be an account ledger (a mapping of account
names to balances.)  We may express this as a type:

```
Protocol State := {
 valid   : Msg -> Boolean;
 init    : State
 observe : State x Msg -> State
}
```

In this type, we represent the set of valid messages for a protocol as
a predicate that determines membership in the set, `valid`. Alacrity
does not actually require users to write a `valid` function; instead
it includes an expressive specification language for these valid
message sets that is guaranteed to produce membership functions with
desirable properties, like computability. This also facilitates
specially compiling protocols for particular blockchain platforms with
expressive message constraints.

Our representation of the interpretation is similarly subtle. It is
plausible to use a representation such as `interp : Chain ->
State`. This is problematic because it means that the interpretation
of `Confirmed m1 c0` can be arbitrarily different from the
interpretation of `c0`. This means, for example, that a message in the
future can cause a message in the past to have a completely different
effect. Our representation (as a catamorphism) guarantees that there
is a unique interpretation of every chain that is independent of the
future. Like with `valid`, Alacrity guarantees that `observe` is
computable and deterministic.

Strictly speaking, `valid` is not necessary, because we could write a
version of `observe` that performs its task:

```
new_observe s m :=
  if valid m then
     observe s m
  else
     s
```

However, we include `valid` because some blockchain platforms offer
the efficient ability to reject messages based on their structure.

From the perspective of Alacrity, the state of a protocol universally
agreed upon and the chain is universal common knowledge. However, the
`init` and `observe` functions are not actually used at runtime. This
is because they can do uncomputable things, like see through all
encryption. The type specification shows this by `observe` receiving
a `Msg` argument and not a `Bytes` argument. This means that the
protocol represents an external, omniscient perspective on the
application state.

A **participant** of a protocol is a particular agent that is taking
part in the protocol conversation. It has its own interpretation of
the state of the protocol that is a reflection of its knowledge, based
on its private, but limited, information. In addition, a participant
has an initial message that it would like to post to the protocol, as
well as a function analogous to `observe` that updates its internal
view and potentially posts messages. Finally, a participant has a
valuation of protocol states that determines their desirability to the
participant.

We represent this as the following type:

```
Participant State (p:Protocol State) Internal View := {
 abstract : View -> Set State
 concrete : State -> View
 value    : State -> Real
 init     : Internal x Maybe Msg
 react    : Internal x View x Raw ->
            Internal x View x Maybe Msg
}
```

In this type, `Internal` represents private information that the
participant holds, such as their secret keys or goals. `View`
represents their perspective on the protocol state. 

A participant must prove that their view and the protocol state form a
Galois connection. They do this by providing the `abstract` and
`concrete` functions. The first translates a private view into the set
of possible real states that it corresponds to. The second translates
a real state into the unique view that it would have. These two
functions must be related:

```
forall (v:View) (s:State),
 In s (abstract v) <-> (concrete s) = v
```

Alacrity includes a specification language for writing views
that automatically derives appropriate abstraction and concretization
functions.

The `value` function represents the valuation of the actual protocol
state. Alacrity guarantees that this function is computable and highly
regular, as it is used in our game-theoretic analysis of the
efficiency of the protocol.

These functions (`abstract`, `concrete`, and `value`) are not actually
executed at runtime, but exist to ensure the correctness of the
participant with respect to the protocol.

At runtime, the participant is initialized with `init` and consumes
messages, then updates their view, with `react`. There is no `View`
component of `init`, because it can be automatically derived by
`concrete p.init`.

The `react` provides an updated view, but it is not free to choose any
view. The new view must be consistent with the `observe` function of
the protocol. The following theorem must be proved:

```
forall (i:Internal) (v:View) (m:Msg) (s:State),
  In s (abstract v) /\ p.valid m ->
  (concrete (p.observe s m)) = (second (react i v (write m)))
```

In other words, for every actual state that the view represents, we
have to ensure that if that protocol state observed this message, then
its concretization is the view returned by the participant.

This is a difficult theorem to prove, because it requires us to
consider all possible messages that might have been sent. The key to
dispatching this theorem easily is ensuring that `react` ignores
messages that it cannot parse (i.e., returns the same view) and that
its abstraction of the state contains all updates that may occur that
it cannot observe. This theorem therefore provides the roadmap for how
to select an abstract view.

It may seem like `Internal` is not necessary, because we could include
it inside of `View` and make an `abstract` that just ignores that
piece and so on. The problem is that `concrete` could not synthesize
information that is truly never in the protocol state, such as the
hidden goals of a participant.

As a final note, participants react to their own messages, so the
`init` value doesn't need to returned an update view and the new view
returned by `react` is the view based on the received message, not the
sent message. This is because message posting may not succeed. A
typical programming pattern will be to store a desired post inside of
`Internal` and continue trying to post until it is successful,
and afterwards removing that internal state.

### Verification

XXX Execution

XXX Compilation

XXX Correctness

XXX Security

XXX Efficiency

### Examples

#### Rock-Paper-Scissors

Two participants want to play Rock-Paper-Scissors, but are distrustful
of the other player peeking or delaying their choice until after the
other exposes themselves. They agree to play on the blockchain.

The protocol proceeds by the players posting their hands,
encrypted. The other player can check if a posting is valid, because
they know the public part of the key. Once a player observes the other
one posting their hand, they reveal their own key. Once both do this,
they can both see the hands and know who one.

The state of the protocol is the actual hands of the players and
whether they've revealed yet. Each player's view is simply whether
they've posted yet, whether the other side posted, and whether they've
revealed yet. When player X has posted, the view is constrained to be
their actual hand. When the other player has posted, X just knows
that the internal state is a `Just`, but doesn't know what the
contents are.

This protocol could be elaborated with "stakes" about what the winner
gets. In this situation, the person that reveals first is at a
disadvantage because the second person can know if they are going to
lose and then not reveal. The court-system-idea comes into play here,
because they can take the chain to a third party and hold the other
side accountable for not revealing; if they are honest, they will do
it, but if they are not audience, the court will give them the
opportunity to reveal that they didn't lose, which, of course, they
will take.

#### Blackjack

The rock-paper-scissors example can be generalized to an interaction
where the submission is not three values (rock, paper, scissors), but
is an arbitrary N-bit number. The result could then be the XOR of the
two numbers. Once the result is available, the rest of the program now
has an N-bit number that neither side controlled the creation of.

If N were 6, then it could designate one of 64 cards in a generalized
version of Blackjack. The two players could then collaboratively
implement the random deck of cards and perform a larger interaction
involving drawing N cards and then deciding whether to draw more and
so. This is generalized version of Blackjack because there are more
than 52 cards and they can appear multiple times in the same deck.

This is an example of the sort of abstraction that we will be able to
build with Alacrity by laying abstractions and protocols.
