import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
};

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  externalSubject: text('external_subject').unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: ['USER', 'ADMIN', 'SUPER_ADMIN'] }).notNull().default('USER'),
  deletionRequestedAt: integer('deletion_requested_at', { mode: 'timestamp_ms' }),
  ...timestamps,
}, (table) => [check('users_role_check', sql`${table.role} IN ('USER', 'ADMIN', 'SUPER_ADMIN')`)]);

// No foreign key: jobs survive removal of the account they are cleaning up.
export const accountDeletionJobs = sqliteTable('account_deletion_jobs', {
  firebaseUid: text('firebase_uid').primaryKey(),
  userId: text('user_id').notNull(),
  requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull(),
  firebaseDeletedAt: integer('firebase_deleted_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }).notNull(),
  lastError: text('last_error'),
}, (table) => [index('account_deletion_jobs_retry_idx').on(table.completedAt, table.nextAttemptAt)]);

export const modules = sqliteTable('modules', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  number: text('number').notNull(),
  academicYear: text('academic_year').notNull(),
  semester: text('semester').notNull(),
  priceCents: integer('price_cents').notNull().default(0),
  ...timestamps,
}, (table) => [
  uniqueIndex('modules_year_semester_number_unique').on(table.academicYear, table.semester, table.number),
  index('modules_filter_idx').on(table.academicYear, table.semester, table.number),
  check('modules_price_nonnegative', sql`${table.priceCents} >= 0`),
]);

export const lectures = sqliteTable('lectures', {
  id: text('id').primaryKey(),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  subject: text('subject').notNull(),
  lectureDate: integer('lecture_date', { mode: 'timestamp_ms' }).notNull(),
  videoUrl: text('video_url').notNull(),
  ...timestamps,
}, (table) => [
  index('lectures_module_idx').on(table.moduleId),
  index('lectures_subject_date_idx').on(table.subject, table.lectureDate),
]);

export const lectureMaterials = sqliteTable('lecture_materials', {
  id: text('id').primaryKey(),
  lectureId: text('lecture_id').notNull().references(() => lectures.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull().unique(),
  originalFilename: text('original_filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  ...timestamps,
}, (table) => [index('materials_lecture_idx').on(table.lectureId)]);

/** A verified private object, before a resource such as a material claims it. */
export const uploads = sqliteTable('uploads', {
  objectKey: text('object_key').primaryKey(),
  purpose: text('purpose', { enum: ['lecture-material', 'payment-receipt', 'flashcard-image'] }).notNull(),
  uploaderId: text('uploader_id').notNull(),
  lectureId: text('lecture_id'),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  attachedAt: integer('attached_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('uploads_pending_attachment_idx').on(table.purpose, table.lectureId, table.completedAt, table.attachedAt),
]);

export const bookingRequests = sqliteTable('booking_requests', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  receiptKey: text('receipt_key').notNull().unique(),
  receiptFilename: text('receipt_filename').notNull(),
  receiptContentType: text('receipt_content_type').notNull(),
  receiptSizeBytes: integer('receipt_size_bytes').notNull(),
  status: text('status', { enum: ['PENDING', 'ACCEPTED', 'REJECTED'] }).notNull().default('PENDING'),
  ...timestamps,
}, (table) => [
  index('bookings_admin_list_idx').on(table.status, table.createdAt),
  uniqueIndex('bookings_one_active_per_user_module').on(table.userId, table.moduleId)
    .where(sql`${table.status} IN ('PENDING', 'ACCEPTED')`),
  check('booking_status_check', sql`${table.status} IN ('PENDING', 'ACCEPTED', 'REJECTED')`),
]);

export const moduleAccess = sqliteTable('module_access', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'cascade' }),
  grantedAt: integer('granted_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.moduleId] })]);

export const flashcards = sqliteTable('flashcards', {
  id: text('id').primaryKey(),
  lectureId: text('lecture_id').notNull().references(() => lectures.id, { onDelete: 'cascade' }),
  frontText: text('front_text'),
  frontImageKey: text('front_image_key'),
  backText: text('back_text'),
  backImageKey: text('back_image_key'),
  ordering: integer('ordering').notNull().default(0),
  ...timestamps,
}, (table) => [
  index('flashcards_lecture_order_idx').on(table.lectureId, table.ordering),
  check('flashcards_front_present', sql`${table.frontText} IS NOT NULL OR ${table.frontImageKey} IS NOT NULL`),
  check('flashcards_back_present', sql`${table.backText} IS NOT NULL OR ${table.backImageKey} IS NOT NULL`),
]);

export const userFlashcardState = sqliteTable('user_flashcard_state', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  flashcardId: text('flashcard_id').notNull().references(() => flashcards.id, { onDelete: 'cascade' }),
  knowledge: text('knowledge', { enum: ['KNOWN', 'UNKNOWN'] }),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  viewedAt: integer('viewed_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.flashcardId] }),
  check('flashcard_knowledge_check', sql`${table.knowledge} IS NULL OR ${table.knowledge} IN ('KNOWN', 'UNKNOWN')`),
]);

export const mcqs = sqliteTable('mcqs', {
  id: text('id').primaryKey(),
  lectureId: text('lecture_id').notNull().references(() => lectures.id, { onDelete: 'cascade' }),
  questionText: text('question_text').notNull(),
  ordering: integer('ordering').notNull().default(0),
  ...timestamps,
}, (table) => [index('mcqs_lecture_order_idx').on(table.lectureId, table.ordering)]);

export const mcqChoices = sqliteTable('mcq_choices', {
  id: text('id').primaryKey(),
  mcqId: text('mcq_id').notNull().references(() => mcqs.id, { onDelete: 'cascade' }),
  choiceText: text('choice_text').notNull(),
  ordering: integer('ordering').notNull(),
  isCorrect: integer('is_correct', { mode: 'boolean' }).notNull(),
}, (table) => [
  index('mcq_choices_question_idx').on(table.mcqId, table.ordering),
  uniqueIndex('mcq_choice_order_unique').on(table.mcqId, table.ordering),
]);
