pragma circom 2.0.0;

// ZK-TemporalDB — RecordClaim circuit
//
// Proves, in zero knowledge:
//   "There is a record in table <tableTag> with primary key <pk>, committed
//    in the Merkle tree whose root is <root>, and its field <fieldName>
//    satisfies <op> against <claimValue>."
//
// Everything else — the other fields, the exact value (for range claims),
// the random salt, and the Merkle path (i.e. every other record) — stays private.
//
// Leaf layout (must match zk-service/src/crypto.js):
//   slot_i = Poseidon(name_i, value_i)                      for i in 0..NFIELDS-1
//   leaf   = Poseidon(tableTag, pk, slot_0..slot_{N-1}, salt)
//   node   = Poseidon(left, right)
//
// op: 0 = EQUALS, 1 = GREATER-OR-EQUAL, 2 = LESS-OR-EQUAL (range ops need values < 2^64)

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

template RecordClaim(DEPTH, NFIELDS) {
    // ---------- public inputs ----------
    signal input root;
    signal input tableTag;
    signal input pk;
    signal input fieldName;
    signal input op;
    signal input claimValue;

    // ---------- private inputs ----------
    signal input names[NFIELDS];
    signal input values[NFIELDS];
    signal input salt;
    signal input fieldIdx;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];

    // 1. Rebuild the leaf from the (private) record contents.
    component slotHash[NFIELDS];
    component leafHash = Poseidon(NFIELDS + 3);
    leafHash.inputs[0] <== tableTag;
    leafHash.inputs[1] <== pk;
    for (var i = 0; i < NFIELDS; i++) {
        slotHash[i] = Poseidon(2);
        slotHash[i].inputs[0] <== names[i];
        slotHash[i].inputs[1] <== values[i];
        leafHash.inputs[2 + i] <== slotHash[i].out;
    }
    leafHash.inputs[NFIELDS + 2] <== salt;

    // 2. Walk the Merkle path up to the root.
    component nodeHash[DEPTH];
    signal cur[DEPTH + 1];
    signal left[DEPTH];
    signal right[DEPTH];
    cur[0] <== leafHash.out;
    for (var d = 0; d < DEPTH; d++) {
        pathIndices[d] * (1 - pathIndices[d]) === 0;          // must be a bit
        left[d]  <== cur[d] + pathIndices[d] * (pathElements[d] - cur[d]);
        right[d] <== pathElements[d] + pathIndices[d] * (cur[d] - pathElements[d]);
        nodeHash[d] = Poseidon(2);
        nodeHash[d].inputs[0] <== left[d];
        nodeHash[d].inputs[1] <== right[d];
        cur[d + 1] <== nodeHash[d].out;
    }
    root === cur[DEPTH];

    // 3. Select the claimed field (index is private, so the verifier
    //    does not even learn the record's column layout).
    component isSel[NFIELDS];
    signal selNameAcc[NFIELDS + 1];
    signal selValAcc[NFIELDS + 1];
    signal selCount[NFIELDS + 1];
    selNameAcc[0] <== 0;
    selValAcc[0] <== 0;
    selCount[0] <== 0;
    for (var i = 0; i < NFIELDS; i++) {
        isSel[i] = IsEqual();
        isSel[i].in[0] <== i;
        isSel[i].in[1] <== fieldIdx;
        selNameAcc[i + 1] <== selNameAcc[i] + isSel[i].out * names[i];
        selValAcc[i + 1]  <== selValAcc[i]  + isSel[i].out * values[i];
        selCount[i + 1]   <== selCount[i]   + isSel[i].out;
    }
    selCount[NFIELDS] === 1;                     // fieldIdx is in range
    selNameAcc[NFIELDS] === fieldName;           // it really is the named field
    signal selVal <== selValAcc[NFIELDS];

    // 4. Evaluate the predicate.
    component opEq  = IsEqual(); opEq.in[0]  <== op; opEq.in[1]  <== 0;
    component opGte = IsEqual(); opGte.in[0] <== op; opGte.in[1] <== 1;
    component opLte = IsEqual(); opLte.in[0] <== op; opLte.in[1] <== 2;
    opEq.out + opGte.out + opLte.out === 1;

    component eq = IsEqual();
    eq.in[0] <== selVal;
    eq.in[1] <== claimValue;

    // Range comparators only see real inputs for range ops; for EQUALS they
    // get zeros so that large (hashed) string values never hit Num2Bits(64).
    signal isRange <== 1 - opEq.out;
    signal a <== isRange * selVal;
    signal b <== isRange * claimValue;
    component gte = GreaterEqThan(64); gte.in[0] <== a; gte.in[1] <== b;
    component lte = LessEqThan(64);    lte.in[0] <== a; lte.in[1] <== b;

    signal t1 <== opEq.out * eq.out;
    signal t2 <== opGte.out * gte.out;
    signal t3 <== opLte.out * lte.out;
    t1 + t2 + t3 === 1;
}

component main {public [root, tableTag, pk, fieldName, op, claimValue]} = RecordClaim(13, 8);
