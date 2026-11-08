// @ts-check

import { createInsertSchema } from "drizzle-zod";
import i18next from "i18next";
import { comments } from "../../db/schema/index.js";

const commentSchema = createInsertSchema(comments, {
  authorName: (schema) => schema.min(2).max(80),
  content: (schema) => schema.min(1).max(2000),
}).pick({ authorName: true, content: true });

export const normalizeComment = (data) => ({
  authorName: typeof data?.authorName === "string" ? data.authorName.trim() : data?.authorName,
  content: typeof data?.content === "string" ? data.content.trim() : data?.content,
});

const formatErrors = (error) =>
  error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: i18next.t(
      issue.path[0] === "authorName"
        ? "views.comments.validation.authorName"
        : "views.comments.validation.content",
    ),
  }));

export const validateComment = (data) => {
  const result = commentSchema.safeParse(normalizeComment(data ?? {}));

  return result.success
    ? { data: result.data, errors: null }
    : { data: null, errors: formatErrors(result.error) };
};
