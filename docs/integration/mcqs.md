# MCQs integration guide

Read [README.md](README.md) first for the base URL and common envelopes. All
endpoints require a Firebase bearer token. Content-management endpoints marked
**Admin** require a local `ADMIN` or `SUPER_ADMIN` role.

```ts
type McqChoiceInput = {
  text: string;      // trimmed, 1–2,000 characters
  isCorrect: boolean;
};

type McqInput = {
  questionText: string; // trimmed, 1–10,000 characters
  ordering?: number;    // non-negative integer; defaults to 0
  choices: [McqChoiceInput, McqChoiceInput, McqChoiceInput, McqChoiceInput];
  // Exactly one choice must be correct.
};

type McqChoice = {
  id: string;
  mcqId: string;
  choiceText: string;
  isCorrect: boolean;
  ordering: number;
};

type Mcq = {
  id: string;
  lectureId: string;
  questionText: string;
  ordering: number;
  choices: McqChoice[];
};
```

The list, create, and update responses return `isCorrect` for every choice.
They are therefore suitable for authoring, answer review, or a client that is
explicitly allowed to receive answer keys; do not rely on the list endpoint to
hide correct answers. `check-answer` is also available for immediate feedback.
This API does not persist quiz attempts, grades, timers, or history.

## `GET /lectures/:lectureId/mcqs`

**Job:** load a lecture's complete questions, choices, and correct-answer flags
in display order for a quiz or answer-review screen.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Expected response — `200 OK`:** `Success<Mcq[]>`.

## `POST /lectures/:lectureId/mcqs` — Admin

**Job:** create one MCQ with its four choices.

**Path DTO:** `type Path = { lectureId: string }; // UUID`

**Request DTO:** `McqInput` above.

**Expected response — `201 Created`:** `Success<Mcq>`.

## `PATCH /mcqs/:mcqId` — Admin

**Job:** update the question text, ordering, and/or all choices.

**Path DTO:** `type Path = { mcqId: string }; // UUID`

**Request DTO**

```ts
type Body = Partial<McqInput>;
```

At least one property is required. If `choices` is supplied, it replaces all
four existing choices and must still contain exactly one correct answer.

**Expected response — `200 OK`:** `Success<Mcq>`.

## `DELETE /mcqs/:mcqId` — Admin

**Job:** permanently delete a question and its choices.

**Path DTO:** `type Path = { mcqId: string }; // UUID`

**Expected response — `204 No Content`.**

## `POST /mcqs/:mcqId/check-answer`

**Job:** check the learner's selected choice immediately after they answer.

**Path DTO:** `type Path = { mcqId: string }; // UUID`

**Request DTO**

```ts
type Body = { choiceId: string }; // UUID; must belong to mcqId
```

**Expected response — `200 OK`**

```ts
type Response = Success<{
  correct: boolean;
  correctChoiceId: string;
}>;
```

Use `correct` to show immediate feedback and `correctChoiceId` to highlight the
right choice after submission. A choice that does not belong to the requested
MCQ returns `404 NOT_FOUND`.
