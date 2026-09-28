// Keep the request DTOs in the OpenAPI-aware Zod instance. The schemas remain
// ordinary Zod schemas at runtime, while Swagger can now use them directly.
import { z } from '@hono/zod-openapi';

export const idParam = z.object({ id: z.string().uuid() });
export const moduleIdParam = z.object({ moduleId: z.string().uuid() });
export const lectureIdParam = z.object({ lectureId: z.string().uuid() });
export const flashcardIdParam = z.object({ flashcardId: z.string().uuid() });
export const mcqIdParam = z.object({ mcqId: z.string().uuid() });
export const bookingIdParam = z.object({ bookingId: z.string().uuid() });

export const moduleInput = z.object({
  title: z.string().trim().min(1).max(200),
  number: z.string().trim().min(1).max(50),
  academicYear: z.string().trim().min(1).max(30),
  semester: z.string().trim().min(1).max(30),
  priceCents: z.number().int().min(0),
});
export const modulePatch = moduleInput.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const lectureInput = z.object({
  title: z.string().trim().min(1).max(250),
  description: z.string().max(10_000).default(''),
  subject: z.string().trim().min(1).max(150),
  lectureDate: z.coerce.date(),
  videoUrl: z.url().max(2_000),
});
export const lecturePatch = lectureInput.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const flashcardFields = z.object({
  frontText: z.string().max(10_000).nullable().optional(),
  frontImageKey: z.string().max(500).nullable().optional(),
  backText: z.string().max(10_000).nullable().optional(),
  backImageKey: z.string().max(500).nullable().optional(),
  ordering: z.number().int().min(0).default(0),
});
export const flashcardInput = flashcardFields.refine((v) => v.frontText || v.frontImageKey, 'A front text or image is required')
  .refine((v) => v.backText || v.backImageKey, 'A back text or image is required');
export const flashcardPatch = flashcardFields.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const mcqFields = z.object({
  questionText: z.string().trim().min(1).max(10_000),
  ordering: z.number().int().min(0).default(0),
  choices: z.array(z.object({ text: z.string().trim().min(1).max(2_000), isCorrect: z.boolean() })).length(4),
});
const exactlyOneCorrect = <T extends { choices?: Array<{ isCorrect: boolean }> }>(value: T) =>
  value.choices === undefined || value.choices.filter((choice) => choice.isCorrect).length === 1;
export const mcqInput = mcqFields.refine(exactlyOneCorrect, 'Exactly one choice must be correct');
export const mcqPatch = mcqFields.partial().refine(exactlyOneCorrect, 'Exactly one choice must be correct')
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
