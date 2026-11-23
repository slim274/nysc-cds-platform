# Document Verification Workflow

This guide explains how an LGI configures document verification and how Corps Member submissions move through AI checks and human review.

## 1. Configure each document requirement

From the LGI Administrator workspace, open **Document Requirements**, select the LGA and create or edit a requirement. Each requirement can use one of three verification modes:

| Mode | Behaviour |
|---|---|
| **Manual** | The submission is placed in the LGI review queue. The LGI opens the file and chooses Mark Verified or Request Resubmission. |
| **AI Auto** | AI checks the document. High-confidence matching results can be marked verified automatically. Clear mismatches are flagged for resubmission; uncertain results or AI service failures are sent to the LGI review queue. |
| **AI-assisted / LGI approval** | AI assesses the document and provides its recommendation, confidence and explanation. The submission still requires an LGI decision; AI does not make the final approval. |

AI verification also depends on the server-level `DOCUMENT_VERIFICATION_MODE=ai` setting, a valid `OPENAI_API_KEY`, and the required reference sample for mandatory documents. If the AI service is disabled or unavailable, the submission falls back to LGI review rather than being silently approved.

## 2. LGI review queue

The **Documents awaiting LGI review** queue includes:

- All Manual submissions.
- AI-assisted submissions that require LGI approval.
- AI Auto submissions with uncertain results or unavailable AI verification.
- AI Auto rejections that the LGI may inspect and manually override.

Each queue item identifies the configured verification mode, the AI provider where applicable, the file, confidence score and verification reason. The LGI should open and inspect the actual document before making a decision.

## 3. Human decision

The LGI can:

- **Mark Verified** — accept the document after checking it. A review note of at least 10 characters is required.
- **Request Resubmission** — return the document with a reason describing what the Corps Member must correct. A review note of at least 10 characters is required.

The LGI decision is recorded with the reviewer identity, reviewer role and timestamp. A human decision on an AI Auto rejection is recorded as an LGI review and replaces the AI outcome as the final document status.

The approval is saved separately from automatic CDS matching. A matching failure must not undo a saved LGI document decision. CDS matching proceeds only after all active mandatory document requirements have a verified latest submission.

## 4. AI Auto and human approval are distinct

An AI Auto document that passes all configured high-confidence checks can be verified without waiting for an LGI action. AI Auto documents that fail or remain uncertain are routed to the LGI as described above. AI-assisted documents always require the LGI's decision. Manual documents always require the LGI's decision.

This lets the LGI choose AI or Manual for each document requirement while retaining human review authority when the system needs intervention.
