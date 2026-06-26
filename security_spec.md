# Security Specification - Claims Management

## Data Invariants
1. A **Claim** must reference a valid `insuranceId`.
2. A **ClaimActivity** must reference a valid `claimId`.
3. Claims can only be modified by Admins or the creator.
4. Closed Claims can ONLY be re-opened or modified by Super Admins.
5. All timestamps must be server-generated.

## The "Dirty Dozen" Payloads

1. **Identity Spoofing**: Attempting to create a claim with a different `createdBy` UID.
2. **State Shortcutting**: Attempting to set `isClosed` to `true` during creation without following the transition logic.
3. **Privilege Escalation**: A non-admin attempting to "re-open" a closed claim.
4. **ID Poisoning**: Creating a claim with a 2KB junk document ID.
5. **PII Leak**: A user listed on insurance A attempting to read a claim for insurance B.
6. **Relational Orphan**: Creating a claim activity for a non-existent `claimId`.
7. **Resource Exhaustion**: Uploading 1000 "document" objects in a single claim update.
8. **Shadow Field injection**: Adding `isVerified: true` to a claim document.
9. **Timestamp Spoofing**: Sending a client-side `createdAt` set to 2 days ago.
10. **Immutability Breach**: Attempting to change the `insuranceId` of an existing claim.
11. **Type Poisoning**: Sending a string to the `date` field expecting a timestamp (or vice versa).
12. **Blanket Read Attack**: Querying the `/claims` collection without being an admin or participant.

## The Test Runner (Logic Verification)

```typescript
// firestore.rules.test.ts
// Tests for claims and claimActivities would go here.
// For now, these scenarios are used to design the rules.
```
