import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Env } from 'hono';
import {
  authSessionInput, flashcardIdParam, flashcardInput, flashcardPatch, lectureIdParam, lectureInput,
  lecturePatch, mcqIdParam, mcqInput, mcqPatch, moduleIdParam, moduleInput,
  modulePatch, profileUpdateInput,
} from './lib/validation';

const uuid = z.string().uuid().openapi({ example: '11111111-1111-4111-8111-111111111111' });
const dateTime = z.string().datetime().openapi({ example: '2026-09-28T12:00:00.000Z' });
const auth = [{ bearerAuth: [] }];

const user = z.object({ id: uuid, email: z.string().email(), name: z.string(), role: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']) }).openapi('User');
const moduleDto = moduleInput.extend({ id: uuid, createdAt: dateTime, updatedAt: dateTime }).openapi('Module');
const lectureDto = lectureInput.extend({ id: uuid, moduleId: uuid, createdAt: dateTime, updatedAt: dateTime, videoLocked: z.boolean().optional() }).openapi('Lecture');
const material = z.object({ id: uuid, lectureId: uuid, originalFilename: z.string(), contentType: z.string(), sizeBytes: z.number().int(), createdAt: dateTime, updatedAt: dateTime }).openapi('Material');
const booking = z.object({ id: uuid, userId: uuid.nullable(), moduleId: uuid, receiptFilename: z.string(), receiptContentType: z.string(), receiptSizeBytes: z.number().int(), status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']), createdAt: dateTime, updatedAt: dateTime }).openapi('Booking');
const flashcard = z.object({ id: uuid, lectureId: uuid, frontText: z.string().nullable(), backText: z.string().nullable(), frontImageUrl: z.string().nullable(), backImageUrl: z.string().nullable(), ordering: z.number().int(), createdAt: dateTime, updatedAt: dateTime }).openapi('Flashcard');
const mcq = z.object({ id: uuid, lectureId: uuid, questionText: z.string(), ordering: z.number().int(), choices: z.array(z.object({ id: uuid, choiceText: z.string(), isCorrect: z.boolean(), ordering: z.number().int() })) }).openapi('Mcq');
const upload = z.object({ objectKey: z.string(), filename: z.string(), contentType: z.string(), sizeBytes: z.number().int() }).openapi('Upload');
const uploadDetails = z.object({ filename: z.string().min(1).max(255), contentType: z.string().min(1).max(255), sizeBytes: z.number().int().positive().max(104_857_600) });
const presignedUpload = upload.extend({ uploadUrl: z.string().url(), expiresAt: dateTime, requiredHeaders: z.object({ 'Content-Type': z.string() }) }).openapi('PresignedUpload');
const completedUpload = uploadDetails.extend({ objectKey: z.string().min(1).max(500) });
const uploadRequest = z.discriminatedUnion('purpose', [
  uploadDetails.extend({ purpose: z.literal('lecture-material'), lectureId: uuid }),
  uploadDetails.extend({ purpose: z.literal('flashcard-image'), lectureId: uuid }),
  uploadDetails.extend({ purpose: z.literal('payment-receipt') }),
]).openapi('UploadRequest');
const uploadCompletion = z.discriminatedUnion('purpose', [
  completedUpload.extend({ purpose: z.literal('lecture-material'), lectureId: uuid }),
  completedUpload.extend({ purpose: z.literal('flashcard-image'), lectureId: uuid }),
  completedUpload.extend({ purpose: z.literal('payment-receipt') }),
]).openapi('UploadCompletion');
const error = z.object({ error: z.object({ code: z.string(), message: z.string(), email_verified: z.boolean().optional(), details: z.unknown().optional() }) }).openapi('ApiError');
const envelope = <T extends z.ZodType>(data: T) => z.object({ data });
const paginated = <T extends z.ZodType>(data: T) => z.object({ data: z.array(data), meta: z.object({ page: z.number().int(), pageSize: z.number().int(), limit: z.number().int(), offset: z.number().int(), total: z.number().int() }) });
const responses = (schema: z.ZodType, status: 200 | 201 = 200, description = 'Successful response') => ({
  [status]: { description, content: { 'application/json': { schema } } },
  401: { description: 'Missing or invalid Firebase ID token', content: { 'application/json': { schema: error } } },
});
const operation = (route: Record<string, unknown>) => createRoute(route as never);
const definitions = new Map<string, ReturnType<typeof operation>>();
const key = (method: string, path: string) => {
  const normalized = (path === '/' ? path : path.replace(/\/+$/, '')).replace(/:([^/]+)/g, '{$1}');
  return `${method.toLowerCase()}:${normalized}`;
};
const add = (route: Record<string, unknown>) => {
  const definition = operation(route);
  definitions.set(key(route.method as string, route.path as string), definition);
  return definition;
};
const secured = (method: string, path: string, tags: string[], summary: string, schema: z.ZodType, request?: Record<string, unknown>, status: 200 | 201 = 200) => add({ method, path, tags, summary, security: auth, ...(request ? { request } : {}), responses: responses(schema, status) });
const noContent = (method: string, path: string, tags: string[], summary: string, request?: Record<string, unknown>) => add({ method, path, tags, summary, security: auth, ...(request ? { request } : {}), responses: { 204: { description: 'Completed successfully' }, 401: { description: 'Missing or invalid Firebase ID token', content: { 'application/json': { schema: error } } } } });

/**
 * Uses the OpenAPI declaration as the real Hono route. An endpoint without a
 * matching declaration fails during Worker startup instead of being silently
 * omitted from Swagger.
 */
export class ApiRouter<E extends Env = Env> extends OpenAPIHono<E> {
  constructor(private readonly prefix: string) {
    super({
      defaultHook(result) {
        if (!result.success) throw result.error;
      },
    });
    this.get = this.document('get') as unknown as typeof this.get;
    this.post = this.document('post') as unknown as typeof this.post;
    this.put = this.document('put') as unknown as typeof this.put;
    this.patch = this.document('patch') as unknown as typeof this.patch;
    this.delete = this.document('delete') as unknown as typeof this.delete;
  }

  private document(method: string) {
    return (path: string, ...handlers: unknown[]) => {
      const definition = definitions.get(key(method, `${this.prefix}${path}`));
      if (!definition) throw new Error(`Missing OpenAPI definition for ${method.toUpperCase()} ${this.prefix}${path}`);
      const localPath = path.replace(/:([^/]+)/g, '{$1}');
      const route = operation({ ...(definition as object), path: localPath, middleware: handlers.slice(0, -1) });
      return this.openapi(route as never, handlers.at(-1) as never) as unknown as this;
    };
  }
}

add({ method: 'get', path: '/health', tags: ['System'], summary: 'Health check', responses: { 200: { description: 'Worker is healthy', content: { 'application/json': { schema: envelope(z.object({ status: z.literal('ok') })) } } } } });
secured('post', '/auth/session', ['Authentication'], 'Create or link the authenticated Firebase user', envelope(z.object({ user, created: z.boolean(), email_verified: z.literal(true) })), { body: { required: false, content: { 'application/json': { schema: authSessionInput.openapi('SessionInput') } } } });
secured('get', '/me', ['Authentication'], 'Get the current local user', envelope(user));
secured('patch', '/me', ['Authentication'], 'Update the current user’s display name', envelope(user), { body: { content: { 'application/json': { schema: profileUpdateInput.openapi('ProfileUpdateInput') } } } });

add({ method: 'delete', path: '/me', tags: ['Authentication'], summary: 'Delete the authenticated account; retain payment receipts and bookings', security: auth,
  responses: {
    202: { description: 'Deletion accepted (or already completed)', content: { 'application/json': { schema: envelope(z.object({ status: z.enum(['pending', 'completed']) })) } } },
    401: { description: 'Invalid token or recent reauthentication required', content: { 'application/json': { schema: error } } },
    503: { description: 'Firebase account deletion is not configured', content: { 'application/json': { schema: error } } },
  },
});

  secured('get', '/modules', ['Modules'], 'List modules', paginated(moduleDto), { query: z.object({ page: z.string().optional(), pageSize: z.string().optional(), number: z.string().optional(), academicYear: z.string().optional(), semester: z.string().optional() }) });
  secured('post', '/modules', ['Modules'], 'Create a module (admin)', envelope(moduleDto), { body: { content: { 'application/json': { schema: moduleInput } } } }, 201);
  secured('get', '/modules/{moduleId}', ['Modules'], 'Get a module', envelope(moduleDto), { params: moduleIdParam });
  secured('patch', '/modules/{moduleId}', ['Modules'], 'Update a module (admin)', envelope(moduleDto), { params: moduleIdParam, body: { content: { 'application/json': { schema: modulePatch } } } });
  noContent('delete', '/modules/{moduleId}', ['Modules'], 'Delete a module (admin)', { params: moduleIdParam });
  secured('get', '/modules/{moduleId}/lectures', ['Modules'], 'List a module’s lectures', paginated(lectureDto.extend({ videoUrl: z.string().url().nullable(), videoLocked: z.boolean(), module: moduleDto })), { params: moduleIdParam });
  secured('post', '/modules/{moduleId}/lectures', ['Modules'], 'Create a lecture (admin)', envelope(lectureDto), { params: moduleIdParam, body: { content: { 'application/json': { schema: lectureInput } } } }, 201);

  secured('get', '/academic-years', ['Catalogue'], 'List available academic years', envelope(z.array(z.string())));
  secured('get', '/semesters', ['Catalogue'], 'List available semesters, optionally for an academic year', envelope(z.array(z.string())), { query: z.object({ academicYear: z.string().optional() }) });
  secured('get', '/subjects', ['Catalogue'], 'List available lecture subjects', envelope(z.array(z.string())), { query: z.object({ moduleId: uuid.optional(), academicYear: z.string().optional(), semester: z.string().optional() }) });

  secured('get', '/lectures', ['Lectures'], 'List lectures', paginated(lectureDto));
  secured('get', '/lectures/{lectureId}', ['Lectures'], 'Get a lecture', envelope(lectureDto), { params: lectureIdParam });
  secured('patch', '/lectures/{lectureId}', ['Lectures'], 'Update a lecture (admin)', envelope(lectureDto), { params: lectureIdParam, body: { content: { 'application/json': { schema: lecturePatch } } } });
  noContent('delete', '/lectures/{lectureId}', ['Lectures'], 'Delete a lecture (admin)', { params: lectureIdParam });
  secured('get', '/lectures/{lectureId}/materials', ['Lectures'], 'List lecture materials', envelope(z.array(material)), { params: lectureIdParam });
  secured('get', '/lectures/{lectureId}/materials/{materialId}/download', ['Lectures'], 'Download a lecture material', z.string().openapi({ format: 'binary' }), { params: lectureIdParam.extend({ materialId: uuid }) });
  secured('patch', '/lectures/{lectureId}/materials/{materialId}', ['Lectures'], 'Rename a lecture material (admin)', envelope(material), { params: lectureIdParam.extend({ materialId: uuid }), body: { content: { 'application/json': { schema: z.object({ originalFilename: z.string().min(1).max(255) }) } } } });
  noContent('delete', '/lectures/{lectureId}/materials/{materialId}', ['Lectures'], 'Delete a lecture material (admin)', { params: lectureIdParam.extend({ materialId: uuid }) });
  secured('get', '/lectures/{lectureId}/video', ['Lectures'], 'Get a lecture video URL when access is granted', envelope(z.object({ videoUrl: z.string().url() })), { params: lectureIdParam });

  add({ method: 'delete', path: '/bookings/receipt', tags: ['Bookings'], summary: 'Receipt deletion disabled; payment receipts are retained', security: auth, responses: { 409: { description: 'Payment receipts cannot be deleted', content: { 'application/json': { schema: error } } }, 401: { description: 'Authentication required', content: { 'application/json': { schema: error } } } }, request: { body: { content: { 'application/json': { schema: z.object({ receiptKey: z.string() }) } } } } });
  secured('post', '/bookings', ['Bookings'], 'Create a booking request', envelope(booking), { body: { content: { 'application/json': { schema: z.object({ moduleId: uuid, receiptKey: z.string() }) } } } }, 201);
  secured('get', '/bookings', ['Bookings'], 'List the current user’s booking requests', envelope(z.array(booking)));
  secured('get', '/admin/bookings', ['Admin'], 'List booking requests (admin)', paginated(booking));
  secured('patch', '/admin/bookings/{bookingId}', ['Admin'], 'Accept or reject a booking (admin)', envelope(booking), { params: z.object({ bookingId: uuid }), body: { content: { 'application/json': { schema: z.object({ status: z.enum(['ACCEPTED', 'REJECTED']) }) } } } });
  secured('get', '/admin/bookings/{bookingId}/receipt', ['Admin'], 'Download a booking receipt (admin)', z.string().openapi({ format: 'binary' }), { params: z.object({ bookingId: uuid }) });
  secured('get', '/admin/users', ['Admin'], 'List users (super admin)', envelope(z.array(user)));
  secured('patch', '/admin/users/{userId}/role', ['Admin'], 'Change a user role (super admin)', envelope(user), { params: z.object({ userId: uuid }), body: { content: { 'application/json': { schema: z.object({ role: z.enum(['USER', 'ADMIN']) }) } } } });

  secured('get', '/lectures/{lectureId}/flashcards', ['Flashcards'], 'List lecture flashcards', envelope(z.array(flashcard)), { params: lectureIdParam });
  secured('post', '/lectures/{lectureId}/flashcards', ['Flashcards'], 'Create a flashcard (admin)', envelope(flashcard), { params: lectureIdParam, body: { content: { 'application/json': { schema: flashcardInput } } } }, 201);
  secured('get', '/flashcards/{flashcardId}', ['Flashcards'], 'Get a flashcard', envelope(flashcard), { params: flashcardIdParam });
  secured('patch', '/flashcards/{flashcardId}', ['Flashcards'], 'Update a flashcard (admin)', envelope(flashcard), { params: flashcardIdParam, body: { content: { 'application/json': { schema: flashcardPatch } } } });
  noContent('delete', '/flashcards/{flashcardId}', ['Flashcards'], 'Delete a flashcard (admin)', { params: flashcardIdParam });
  secured('put', '/flashcards/{flashcardId}/state', ['Flashcards'], 'Update the current user’s flashcard state', envelope(z.object({ knowledge: z.enum(['KNOWN', 'UNKNOWN']).nullable().optional(), hidden: z.boolean().optional(), viewed: z.boolean().optional() })), { params: flashcardIdParam, body: { content: { 'application/json': { schema: z.object({ knowledge: z.enum(['KNOWN', 'UNKNOWN']).nullable().optional(), hidden: z.boolean().optional(), viewed: z.boolean().optional() }) } } } });
  secured('get', '/lectures/{lectureId}/flashcards/progress', ['Flashcards'], 'Get flashcard progress', envelope(z.object({ total: z.number().int(), known: z.number().int(), hidden: z.number().int() })), { params: lectureIdParam });

  secured('post', '/uploads', ['Uploads'], 'Create a direct R2 upload URL', envelope(presignedUpload), { body: { content: { 'application/json': { schema: uploadRequest } } } }, 201);
  secured('post', '/uploads/complete', ['Uploads'], 'Verify a direct upload and perform its resource-specific attachment', envelope(z.union([upload, material])), { body: { content: { 'application/json': { schema: uploadCompletion } } } }, 201);

  secured('get', '/lectures/{lectureId}/mcqs', ['MCQs'], 'List a lecture’s MCQs', envelope(z.array(mcq)), { params: lectureIdParam });
  secured('post', '/lectures/{lectureId}/mcqs', ['MCQs'], 'Create an MCQ (admin)', envelope(mcq), { params: lectureIdParam, body: { content: { 'application/json': { schema: mcqInput } } } }, 201);
  secured('patch', '/mcqs/{mcqId}', ['MCQs'], 'Update an MCQ (admin)', envelope(mcq), { params: mcqIdParam, body: { content: { 'application/json': { schema: mcqPatch } } } });
  noContent('delete', '/mcqs/{mcqId}', ['MCQs'], 'Delete an MCQ (admin)', { params: mcqIdParam });
  secured('post', '/mcqs/{mcqId}/check-answer', ['MCQs'], 'Check an MCQ answer', envelope(z.object({ correct: z.boolean(), correctChoiceId: uuid })), { params: mcqIdParam, body: { content: { 'application/json': { schema: z.object({ choiceId: uuid }) } } } });
