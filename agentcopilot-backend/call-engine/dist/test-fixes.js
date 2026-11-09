"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const session_1 = require("./session");
const kb_1 = require("./kb");
function makeSession() {
    const events = [];
    const socket = {
        emit: (name, payload) => {
            if (name === "agent-event")
                events.push(payload);
        },
    };
    return { session: new session_1.CallSession(socket, "live"), events };
}
async function testPartialFinalSeq() {
    const { session, events } = makeSession();
    await session.onPartial("good morning", 0.8, "customer");
    await session.onPartial("good morning how are", 0.85, "customer");
    await session.onFinal("good morning how are you", 0.98, "customer");
    const deltas = events.filter((e) => e.event_type === "TRANSCRIPTION_DELTA");
    assert_1.default.equal(deltas.length, 3, "expected 2 partials + 1 final");
    assert_1.default.equal(deltas[0].payload.seq, deltas[1].payload.seq, "partials must share seq");
    assert_1.default.equal(deltas[1].payload.seq, deltas[2].payload.seq, "final must reuse partial seq");
    await session.onPartial("next utterance", 0.8, "customer");
    const all = events.filter((e) => e.event_type === "TRANSCRIPTION_DELTA");
    assert_1.default.notEqual(all[3].payload.seq, all[0].payload.seq, "new utterance must get a new seq");
    console.log("[PASS] partial/final seq stability");
}
function testIntents() {
    assert_1.default.equal((0, session_1.detectIntent)("How much time will it take to unblock my card?"), "card.unblock_tat");
    assert_1.default.equal((0, session_1.detectIntent)("Card kab unblock hoga?"), "card.unblock_tat");
    assert_1.default.equal((0, session_1.detectIntent)("Unblock charges kitne lagenge? Annual fee waiver policy kya hai?"), "card.unblock_fees");
    assert_1.default.equal((0, session_1.detectIntent)("What is the TAT, kitna time lagega?"), "card.unblock_tat");
    assert_1.default.equal((0, session_1.detectIntent)("Kya aap call recording kar rahe ho?"), "call.opening_disclosure");
    assert_1.default.equal((0, session_1.detectIntent)("Please verify my KYC and DOB"), "kyc.verify_identity");
    console.log("[PASS] intent routing");
}
function testKbDocsCustomerSafe() {
    const joined = kb_1.KB_DOCS.map((d) => d.doc).join("\n").toLowerCase();
    assert_1.default.ok(!joined.includes("every call must open with"), "internal disclosure instruction leaked");
    assert_1.default.ok(!joined.includes("two independent factors"), "internal KYC instruction leaked");
    assert_1.default.ok(!joined.includes("must complete before any account"), "internal KYC instruction leaked");
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
