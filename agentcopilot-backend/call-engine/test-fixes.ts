import assert from "assert";
import { CallSession, detectIntent } from "./session";
import { KB_DOCS } from "./kb";

function makeSession(): { session: CallSession; events: any[] } {
  const events: any[] = [];
  const socket = {
    emit: (name: string, payload: any) => {
      if (name === "agent-event") events.push(payload);
    },
  };
  return { session: new CallSession(socket as any, "live"), events };
}

async function testPartialFinalSeq() {
  const { session, events } = makeSession();
  await session.onPartial("good morning", 0.8, "customer");
  await session.onPartial("good morning how are", 0.85, "customer");
  await session.onFinal("good morning how are you", 0.98, "customer");
  const deltas = events.filter((e: any) => e.event_type === "TRANSCRIPTION_DELTA");
  assert.equal(deltas.length, 3, "expected 2 partials + 1 final");
  assert.equal(deltas[0].payload.seq, deltas[1].payload.seq, "partials must share seq");
  assert.equal(deltas[1].payload.seq, deltas[2].payload.seq, "final must reuse partial seq");

  await session.onPartial("next utterance", 0.8, "customer");
  const all = events.filter((e: any) => e.event_type === "TRANSCRIPTION_DELTA");
  assert.notEqual(all[3].payload.seq, all[0].payload.seq, "new utterance must get a new seq");
  console.log("[PASS] partial/final seq stability");
}

function testIntents() {
  assert.equal(
    detectIntent("How much time will it take to unblock my card?"),
    "card.unblock_tat"
  );
  assert.equal(detectIntent("Card kab unblock hoga?"), "card.unblock_tat");
  assert.equal(
    detectIntent("Unblock charges kitne lagenge? Annual fee waiver policy kya hai?"),
    "card.unblock_fees"
  );
  assert.equal(detectIntent("What is the TAT, kitna time lagega?"), "card.unblock_tat");
  assert.equal(detectIntent("Kya aap call recording kar rahe ho?"), "call.opening_disclosure");
  assert.equal(detectIntent("Please verify my KYC and DOB"), "kyc.verify_identity");
  console.log("[PASS] intent routing");
}

function testKbDocsCustomerSafe() {
  const joined = KB_DOCS.map((d) => d.doc).join("\n").toLowerCase();
  assert.ok(!joined.includes("every call must open with"), "internal disclosure instruction leaked");
  assert.ok(!joined.includes("two independent factors"), "internal KYC instruction leaked");
  assert.ok(!joined.includes("must complete before any account"), "internal KYC instruction leaked");
  console.log("[PASS] KB docs are customer-safe");
}

async function run() {
  await testPartialFinalSeq();
  testIntents();
  testKbDocsCustomerSafe();
  console.log("\nALL REGRESSION TESTS PASSED");
  process.exit(0);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err.message);
  process.exit(1);
});
