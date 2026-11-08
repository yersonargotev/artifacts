--------------------------- MODULE BatchConcurrency ---------------------------
(***************************************************************************)
(* store.batch (packages/artifacts/src/index.ts) racing other writers.     *)
(*                                                                         *)
(* A batch reads on the plain database (the receipt, the owned projects,   *)
(* and the named pages, as three separate statements in a Promise.all),    *)
(* plans with planBatch (packages/artifacts/src/batch.ts), and sends every *)
(* write and its receipt as one atomic libSQL batch(..., 'write'). Nothing *)
(* inside that write request reads, so the schema guards and the `moved`   *)
(* statement must reject every plan that a stale read let through. On a    *)
(* SQLITE_CONSTRAINT the store reads and plans again, up to Attempts times. *)
(*                                                                         *)
(* The other writers are the interactive commands create, update, move,    *)
(* and delete. Each runs inside writeTransaction (packages/artifacts/src/  *)
(* access.ts), which SQLite serializes, so each is one atomic step here.   *)
(*                                                                         *)
(* One owner. Every project spelling in Spellings is a letter-case variant *)
(* of one project key, as projectKey (panel/model.ts) folds them.          *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
  NULL,             \* SQL NULL and an omitted optional field
  Slugs,
  MaxOps,           \* longest batch b1 submits
  Retry,            \* TRUE: b2 retries b1's request ID with the same operations
  MaxInteractive,   \* interactive commands that may commit during the run
  Attempts,         \* write requests per batch call: `conflicts++ < 2` allows 3
  \* Guards, read from the code by scripts/check.ts. FALSE models the code without that guard.
  SeqIndex,         \* schema.ts uniqueIndex artifact_revision_sequence_idx (artifact_id, sequence)
  SlugIndex,        \* schema.ts uniqueIndex artifact_owner_project_slug_idx (owner, coalesce(project, ''), slug)
  ReceiptKey,       \* schema.ts artifact_command primaryKey (owner_id, request_id)
  MovedGuard,       \* index.ts `moved(actor.userId, write)` statement after each batch move
  SpellingGuard,    \* index.ts `spelled(...)` statement: no project spelling outside the read and planned ones
  HeadGuard         \* index.ts batch head update `where head_revision_id = parentRevisionId`

ASSUME Attempts \in 1..5 /\ MaxOps \in 1..3 /\ MaxInteractive \in 0..3

\* Two letter-case variants of one project name, in projectOrder (access.ts): localeCompare('en') puts
\* lower case first, so projectSpelling and the planner's seed adopt "docs" when both are stored.
SortedSpellings == <<"docs", "Docs">>
Spellings == {SortedSpellings[1], SortedSpellings[2]}
Keep == "keep"   \* a move field left undefined keeps its current value
Key(p) == IF p = NULL THEN "unfiled" ELSE "project"
Req == "req1"
Procs == IF Retry THEN {"b1", "b2"} ELSE {"b1"}
P1 == <<"existing", "artifact">>
P1Head == <<"existing", "revision">>

\* Operations a batch may carry (contracts batchOperationSchema). p1 is the only page a caller can name by ID.
Creates == [op : {"create"}, project : Spellings \cup {NULL}, slug : Slugs \cup {NULL}]
UpdatesById == [op : {"update"}, id : {P1}, project : {NULL}, slug : {NULL}, expected : {P1Head, NULL}]
UpdatesBySlug == [op : {"update"}, id : {NULL}, project : Spellings \cup {NULL}, slug : Slugs, expected : {P1Head, NULL}]
Moves == [op : {"move"}, id : {P1}, project : Spellings \cup {NULL, Keep}, slug : Slugs \cup {NULL, Keep}]
Ops == Creates \cup UpdatesById \cup UpdatesBySlug \cup {m \in Moves : m.project # Keep \/ m.slug # Keep}
Batches == UNION {[1..n -> Ops] : n \in 1..MaxOps}

VARIABLES
  arts,       \* artifact rows: id -> [project, slug, head]
  revs,       \* artifact_revision rows: [id, art, parent, seq]
  receipts,   \* artifact_command rows of the batch request: Req -> [payload, results, deleted]
  ops,        \* the operations b1 (and its retry b2) submit
  pc,         \* batch call: "read" | "write" | "done"
  seen,       \* this attempt's reads; NULL until that read ran
  attempt,
  outcome,    \* what the batch call returned
  icount,     \* interactive commands run so far
  commits,    \* ghost: write requests that committed the batch receipt
  truthful    \* ghost: every committed batch left the rows its results describe

vars == <<arts, revs, receipts, ops, pc, seen, attempt, outcome, icount, commits, truthful>>

Unread == [receipt |-> NULL, projects |-> NULL, pages |-> NULL]
RevsOf(a) == {r \in revs : r.art = a}
SeqOf(a, rid) == (CHOOSE r \in RevsOf(a) : r.id = rid).seq

Init ==
  /\ \E place \in {[project |-> NULL, slug |-> "a"], [project |-> SortedSpellings[1], slug |-> "b"]} :
       arts = P1 :> [project |-> place.project, slug |-> place.slug, head |-> P1Head]
  /\ revs = {[id |-> P1Head, art |-> P1, parent |-> NULL, seq |-> 1]}
  /\ receipts = [r \in {} |-> NULL]
  /\ ops \in Batches
  /\ pc = [p \in Procs |-> "read"]
  /\ seen = [p \in Procs |-> Unread]
  /\ attempt = [p \in Procs |-> 1]
  /\ outcome = [p \in Procs |-> NULL]
  /\ icount = 0
  /\ commits = 0
  /\ truthful = TRUE

-----------------------------------------------------------------------------
(* Read phase: replay(), ownedProjects(), and the pages query run as three *)
(* statements, each at its own moment.                                     *)

Ids == {ops[i].id : i \in {j \in DOMAIN ops : ops[j].op # "create"}} \ {NULL}
NamedSlugs == {ops[i].slug : i \in DOMAIN ops} \ {NULL, Keep}

ReadReceipt(p) ==
  /\ pc[p] = "read" /\ seen[p].receipt = NULL
  /\ seen' = [seen EXCEPT ![p].receipt = IF Req \in DOMAIN receipts THEN {receipts[Req]} ELSE {}]
  /\ UNCHANGED <<arts, revs, receipts, ops, pc, attempt, outcome, icount, commits, truthful>>

ReadProjects(p) ==
  /\ pc[p] = "read" /\ seen[p].projects = NULL
  /\ seen' = [seen EXCEPT ![p].projects = {arts[a].project : a \in DOMAIN arts} \ {NULL}]
  /\ UNCHANGED <<arts, revs, receipts, ops, pc, attempt, outcome, icount, commits, truthful>>

\* By ID, by any named slug in any project, or by the slug an ID-named page holds (the `held` subquery).
ReadPages(p) ==
  /\ pc[p] = "read" /\ seen[p].pages = NULL
  /\ LET held == {arts[a].slug : a \in Ids \cap DOMAIN arts} \ {NULL}
         sel == {a \in DOMAIN arts : a \in Ids \/ arts[a].slug \in NamedSlugs \cup held}
     IN seen' = [seen EXCEPT ![p].pages =
          [a \in sel |-> [project |-> arts[a].project, slug |-> arts[a].slug, head |-> arts[a].head,
                          seq |-> SeqOf(a, arts[a].head), written |-> FALSE]]]
  /\ UNCHANGED <<arts, revs, receipts, ops, pc, attempt, outcome, icount, commits, truthful>>

-----------------------------------------------------------------------------
(* planBatch over the read namespace. `cur` is the spellings map, which    *)
(* holds at most one entry because Spellings share one key.                *)

Spell(cur, name) == IF cur = NULL THEN name ELSE cur
SpellOpt(cur, name) == IF name = NULL THEN NULL ELSE Spell(cur, name)
CurAfter(cur, name) == IF name = NULL \/ cur # NULL THEN cur ELSE name
Holders(ns, project, slug) ==
  IF slug = NULL THEN {} ELSE {id \in DOMAIN ns : ns[id].project = project /\ ns[id].slug = slug}

Fail(st, code, i) == [st EXCEPT !.err = <<code, i>>]

PlanOp(st, i, p) ==
  LET o == ops[i] IN
  IF st.err # NULL THEN st
  ELSE IF o.op = "create" THEN
    LET proj == SpellOpt(st.cur, o.project)
        aid == <<p, st.att, i, "artifact">>
        rid == <<p, st.att, i, "revision">>
    IN IF Holders(st.ns, proj, o.slug) # {} THEN Fail(st, "slug_conflict", i)
       ELSE [st EXCEPT !.cur = CurAfter(st.cur, o.project),
                       !.ns = (aid :> [project |-> proj, slug |-> o.slug, head |-> rid, seq |-> 1, written |-> TRUE]) @@ st.ns,
                       !.writes = Append(st.writes, [op |-> "create", id |-> aid, rev |-> rid, project |-> proj, slug |-> o.slug]),
                       !.results = Append(st.results, <<i, aid, rid>>)]
  ELSE IF o.op = "move" THEN
    IF o.id \notin DOMAIN st.ns THEN Fail(st, "not_found", i)
    ELSE
    LET t == st.ns[o.id]
        proj == IF o.project = Keep THEN t.project ELSE SpellOpt(st.cur, o.project)
        cur2 == IF o.project = Keep THEN st.cur ELSE CurAfter(st.cur, o.project)
        slug == IF o.slug = Keep THEN t.slug ELSE o.slug
    IN IF Holders(st.ns, proj, slug) \ {o.id} # {} THEN Fail(st, "slug_conflict", i)
       ELSE [st EXCEPT !.cur = cur2,
                       !.ns = [st.ns EXCEPT ![o.id].project = proj, ![o.id].slug = slug],
                       !.writes = Append(st.writes, [op |-> "move", id |-> o.id, rev |-> t.head, fromProject |-> t.project,
                                                     fromSlug |-> t.slug, project |-> proj, slug |-> slug]),
                       !.results = Append(st.results, <<i, o.id, t.head>>)]
  ELSE \* update, located by ID or by (project, slug)
    LET cur2 == IF o.id = NULL THEN CurAfter(st.cur, o.project) ELSE st.cur
        found == IF o.id # NULL THEN (IF o.id \in DOMAIN st.ns THEN {o.id} ELSE {})
                 ELSE Holders(st.ns, SpellOpt(st.cur, o.project), o.slug)
    IN IF found = {} THEN Fail(st, "not_found", i)
       ELSE
       LET tid == CHOOSE x \in found : TRUE
           t == st.ns[tid]
           rid == <<p, st.att, i, "revision">>
           stale == IF o.expected = NULL THEN ~t.written ELSE o.expected # t.head
       IN IF stale THEN Fail(st, "conflict", i)
          ELSE [st EXCEPT !.cur = cur2,
                          !.ns = [st.ns EXCEPT ![tid].head = rid, ![tid].seq = t.seq + 1, ![tid].written = TRUE],
                          !.writes = Append(st.writes, [op |-> "update", id |-> tid, rev |-> rid, parent |-> t.head, seq |-> t.seq + 1]),
                          !.results = Append(st.results, <<i, tid, rid>>)]

RECURSIVE PlanFrom(_, _, _)
PlanFrom(st, i, p) == IF i > Len(ops) THEN st ELSE PlanFrom(PlanOp(st, i, p), i + 1, p)

First(set) == LET i == CHOOSE j \in DOMAIN SortedSpellings : SortedSpellings[j] \in set /\ \A k \in 1..(j - 1) : SortedSpellings[k] \notin set
              IN SortedSpellings[i]

Plan(p) ==
  LET r == seen[p] IN
  PlanFrom([cur |-> IF r.projects = {} THEN NULL ELSE First(r.projects), ns |-> r.pages,
            writes |-> << >>, results |-> << >>, err |-> NULL, att |-> attempt[p]], 1, p)

-----------------------------------------------------------------------------
(* The write request: every statement in order inside one transaction. A  *)
(* constraint failure in any statement rolls the whole request back.       *)

SlugTaken(as, id, project, slug) ==
  slug # NULL /\ \E x \in DOMAIN as : x # id /\ as[x].project = project /\ as[x].slug = slug

Exec(db, w) ==
  IF db.failed THEN db
  ELSE IF w.op = "create" THEN
    IF SlugIndex /\ SlugTaken(db.arts, w.id, w.project, w.slug) THEN [db EXCEPT !.failed = TRUE]
    ELSE [db EXCEPT !.arts = (w.id :> [project |-> w.project, slug |-> w.slug, head |-> w.rev]) @@ db.arts,
                    !.revs = db.revs \cup {[id |-> w.rev, art |-> w.id, parent |-> NULL, seq |-> 1]}]
  ELSE IF w.op = "update" THEN
    \* The revision insert: its foreign key to artifact, then the sequence index.
    IF w.id \notin DOMAIN db.arts THEN [db EXCEPT !.failed = TRUE]
    ELSE IF SeqIndex /\ \E r \in db.revs : r.art = w.id /\ r.seq = w.seq THEN [db EXCEPT !.failed = TRUE]
    ELSE LET revs2 == db.revs \cup {[id |-> w.rev, art |-> w.id, parent |-> w.parent, seq |-> w.seq]}
             matches == ~HeadGuard \/ db.arts[w.id].head = w.parent
         IN [db EXCEPT !.revs = revs2, !.arts = IF matches THEN [db.arts EXCEPT ![w.id].head = w.rev] ELSE db.arts]
  ELSE \* move: the update matches only the planned source location, then the `moved` statement checks the result
    LET matches == w.id \in DOMAIN db.arts /\ db.arts[w.id].project = w.fromProject /\ db.arts[w.id].slug = w.fromSlug
    IN IF matches /\ SlugIndex /\ SlugTaken(db.arts, w.id, w.project, w.slug) THEN [db EXCEPT !.failed = TRUE]
       ELSE LET arts2 == IF matches THEN [db.arts EXCEPT ![w.id].project = w.project, ![w.id].slug = w.slug] ELSE db.arts
                landed == w.id \in DOMAIN arts2 /\ arts2[w.id].head = w.rev /\ arts2[w.id].project = w.project /\ arts2[w.id].slug = w.slug
            IN IF MovedGuard /\ ~landed THEN [db EXCEPT !.failed = TRUE] ELSE [db EXCEPT !.arts = arts2]

RECURSIVE ExecFrom(_, _, _)
ExecFrom(db, ws, i) == IF i > Len(ws) THEN db ELSE ExecFrom(Exec(db, ws[i]), ws, i + 1)

\* Right after the commit, every page the batch wrote has the head its results report, and every page a
\* create or move placed sits where the plan put it. An update claims a revision, not a location.
Describes(db, st) ==
  \A i \in DOMAIN st.writes :
    LET w == st.writes[i] IN
    /\ w.id \in DOMAIN db.arts
    /\ db.arts[w.id].head = st.ns[w.id].head
    /\ w.op \in {"create", "move"} =>
         db.arts[w.id].project = st.ns[w.id].project /\ db.arts[w.id].slug = st.ns[w.id].slug

Finish(p, result) ==
  /\ pc' = [pc EXCEPT ![p] = "done"]
  /\ outcome' = [outcome EXCEPT ![p] = result]

Write(p) ==
  /\ pc[p] = "read"
  /\ seen[p].receipt # NULL /\ seen[p].projects # NULL /\ seen[p].pages # NULL
  /\ LET found == seen[p].receipt IN
     IF found # {} THEN LET stored == CHOOSE s \in found : TRUE IN
       /\ Finish(p, IF stored.deleted THEN "not_found" ELSE IF stored.payload # ops THEN "request_conflict" ELSE <<"replayed", stored.results>>)
       /\ UNCHANGED <<arts, revs, receipts, ops, seen, attempt, icount, commits, truthful>>
     ELSE
       LET st == Plan(p) IN
       IF st.err # NULL THEN
         /\ Finish(p, st.err)
         /\ UNCHANGED <<arts, revs, receipts, ops, seen, attempt, icount, commits, truthful>>
       ELSE
         LET db == ExecFrom([arts |-> arts, revs |-> revs, failed |-> FALSE], st.writes, 1)
             placed == {st.writes[i].project : i \in {j \in DOMAIN st.writes : st.writes[j].op # "update"}} \ {NULL}
             \* Every spelling shares one key, so a known set of two names that project twice and becomes empty.
             known == IF Cardinality(seen[p].projects \cup placed) <= 1 THEN seen[p].projects \cup placed ELSE {}
             spellFails == SpellingGuard /\ placed # {} /\
               \E a \in DOMAIN db.arts : db.arts[a].project \notin known \cup {NULL}
             receiptFails == ReceiptKey /\ Req \in DOMAIN receipts
         IN IF db.failed \/ spellFails \/ receiptFails THEN
              IF attempt[p] < Attempts THEN
                /\ attempt' = [attempt EXCEPT ![p] = attempt[p] + 1]
                /\ seen' = [seen EXCEPT ![p] = Unread]
                /\ UNCHANGED <<arts, revs, receipts, ops, pc, outcome, icount, commits, truthful>>
              ELSE
                /\ Finish(p, "constraint_error")
                /\ UNCHANGED <<arts, revs, receipts, ops, seen, attempt, icount, commits, truthful>>
            ELSE
              /\ arts' = db.arts
              /\ revs' = db.revs
              /\ receipts' = [r \in (DOMAIN receipts) \cup {Req} |-> [payload |-> ops, results |-> st.results, deleted |-> FALSE]]
              /\ commits' = commits + 1
              /\ truthful' = (truthful /\ Describes(db, st))
              /\ Finish(p, <<"ok", st.results>>)
              /\ UNCHANGED <<ops, seen, attempt, icount>>

-----------------------------------------------------------------------------
(* Interactive commands, each one serialized transaction.                  *)

\* projectSpelling (access.ts): adopt the owner's stored spelling of the key, first in projectOrder.
ProjectSpelling(name) ==
  LET stored == {arts[a].project : a \in DOMAIN arts} \ {NULL}
  IN IF name = NULL THEN NULL ELSE IF stored = {} THEN name ELSE First(stored)

Interactive ==
  /\ icount < MaxInteractive
  /\ icount' = icount + 1
  /\ UNCHANGED <<ops, pc, seen, attempt, outcome, commits, truthful>>

\* create: projectSpelling, claimSlug, then the artifact and revision 1.
Create(sp, sl) ==
  /\ Interactive
  /\ LET proj == ProjectSpelling(sp)
         aid == <<"interactive", icount, "artifact">>
         rid == <<"interactive", icount, "revision">>
     IN IF SlugTaken(arts, aid, proj, sl) THEN UNCHANGED <<arts, revs, receipts>>
        ELSE /\ arts' = (aid :> [project |-> proj, slug |-> sl, head |-> rid]) @@ arts
             /\ revs' = revs \cup {[id |-> rid, art |-> aid, parent |-> NULL, seq |-> 1]}
             /\ UNCHANGED receipts

\* update with the current head as expectedRevisionId.
Update(a) ==
  /\ Interactive
  /\ a \in DOMAIN arts
  /\ revs' = revs \cup {[id |-> <<"interactive", icount, "revision">>, art |-> a, parent |-> arts[a].head, seq |-> SeqOf(a, arts[a].head) + 1]}
  /\ arts' = [arts EXCEPT ![a].head = <<"interactive", icount, "revision">>]
  /\ UNCHANGED receipts

\* move: projectSpelling, claimSlug excluding the page itself, then the new location.
Move(a, sp, sl) ==
  /\ Interactive
  /\ a \in DOMAIN arts
  /\ LET proj == IF sp = Keep THEN arts[a].project ELSE ProjectSpelling(sp)
         slug == IF sl = Keep THEN arts[a].slug ELSE sl
     IN IF SlugTaken(arts, a, proj, slug) THEN UNCHANGED <<arts, revs, receipts>>
        ELSE /\ arts' = [arts EXCEPT ![a].project = proj, ![a].slug = slug]
             /\ UNCHANGED <<revs, receipts>>

\* delete: scrub receipts that name the artifact, then delete it; revisions cascade.
Delete(a) ==
  /\ Interactive
  /\ a \in DOMAIN arts
  /\ arts' = [x \in (DOMAIN arts) \ {a} |-> arts[x]]
  /\ revs' = {r \in revs : r.art # a}
  /\ receipts' = [r \in DOMAIN receipts |->
       IF \E k \in DOMAIN receipts[r].results : receipts[r].results[k][2] = a
       THEN [payload |-> NULL, results |-> << >>, deleted |-> TRUE] ELSE receipts[r]]

Done ==
  /\ \A p \in Procs : pc[p] = "done"
  /\ UNCHANGED vars

Next ==
  \/ \E p \in Procs : ReadReceipt(p) \/ ReadProjects(p) \/ ReadPages(p) \/ Write(p)
  \/ \E sp \in Spellings \cup {NULL}, sl \in Slugs \cup {NULL} : Create(sp, sl)
  \/ \E a \in DOMAIN arts : Update(a) \/ Delete(a)
  \/ \E a \in DOMAIN arts, sp \in Spellings \cup {NULL, Keep}, sl \in Slugs \cup {NULL, Keep} : Move(a, sp, sl)
  \/ Done

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Properties *)

\* Every revision of a page is on one parent chain that ends at its head: no orphan, no fork.
LinearHistory ==
  \A a \in DOMAIN arts :
    /\ \E r \in RevsOf(a) : r.id = arts[a].head
    /\ \A r \in RevsOf(a) : r.id = arts[a].head \/ \E c \in RevsOf(a) : c.parent = r.id
    /\ \A r \in RevsOf(a) : Cardinality({c \in RevsOf(a) : c.parent = r.id}) <= 1

\* A batch that answers success left every page it wrote where its results say.
BatchReportsTruth == truthful

\* One request ID applies its operations at most once, however its calls race or retry.
ExactlyOnce == commits <= 1

\* The slug index holds: a (stored project spelling, slug) pair names at most one page.
SlugNamesOnePage ==
  \A a, b \in DOMAIN arts : a # b => ~(arts[a].slug # NULL /\ arts[a].slug = arts[b].slug /\ arts[a].project = arts[b].project)

\* Projects group by letter case (docs/decisions/projects.md), so one project has one stored spelling.
OneSpellingPerProject ==
  \A a, b \in DOMAIN arts :
    (arts[a].project # NULL /\ arts[b].project # NULL) => arts[a].project = arts[b].project

\* A slug names one page in a project, whatever letter case each page's project was stored in.
SlugNamesOnePageInProject ==
  \A a, b \in DOMAIN arts : a # b =>
    ~(arts[a].slug # NULL /\ arts[a].slug = arts[b].slug /\ Key(arts[a].project) = Key(arts[b].project))

TypeOK ==
  /\ \A p \in Procs : pc[p] \in {"read", "done"} /\ attempt[p] \in 1..Attempts
  /\ icount \in 0..MaxInteractive
=============================================================================
