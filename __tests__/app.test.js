// @ts-check

import { and, asc, eq } from "drizzle-orm";
import fastify from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { articles, comments } from "../db/schema/index.js";
import init from "../server/plugin.js";

// TODO: сейчас каждый тест оставляет после себя артефакты в БД
// попытатся использовать транзакции или перед каждым тестом очищать БД

describe("requests", () => {
  let app;

  // Sequelize отдавал модель с findOne/findByPk. У drizzle это запросы, поэтому
  // два маленьких хелпера вместо повторения select().from().where() в каждом
  // тесте. `?? null` сохраняет прежнее поведение: не найдено это null, а не
  // undefined, и проверки toBeNull() остаются осмысленными.
  const findArticle = async ({ title, content }) => {
    const [article] = await app.db
      .select()
      .from(articles)
      .where(and(eq(articles.title, title), eq(articles.content, content)))
      .limit(1);

    return article ?? null;
  };

  const findArticleById = async (id) => {
    const [article] = await app.db.select().from(articles).where(eq(articles.id, id)).limit(1);

    return article ?? null;
  };

  const findCommentsByArticleId = async (articleId) =>
    app.db
      .select()
      .from(comments)
      .where(eq(comments.articleId, articleId))
      .orderBy(asc(comments.createdAt), asc(comments.id));

  beforeAll(async () => {
    app = fastify({
      exposeHeadRoutes: false,
      logger: { target: "pino-pretty" },
    });
    await init(app);
  });

  test("GET 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: app.reverse("root"),
    });
    expect(res.statusCode).toBe(200);
  });

  test("GET 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/wrong-path",
    });
    expect(res.statusCode).toBe(404);
  });

  test("show articles - GET /articles", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/articles",
    });

    expect(response.statusCode).toBe(200);
  });

  test("new article - GET /articles/new", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/articles/new",
    });

    expect(response.statusCode).toBe(200);
  });

  test("create article - POST /articles", async () => {
    const newArticleData = {
      title: "Article 1",
      content: "Article 1 content",
    };

    const response = await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    expect(response.statusCode).toBe(302);

    const article = await findArticle(newArticleData);
    expect(article).not.toBeNull();
  });

  test("edit article - GET /articles/:id", async () => {
    const newArticleData = {
      title: "Article 2",
      content: "Article 2 content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    const newArticle = await findArticle(newArticleData);

    const response2 = await app.inject({
      method: "GET",
      url: `/articles/${newArticle.id}`,
    });

    expect(response2.statusCode).toBe(200);
  });

  test("update article - PATCH /articles/:id", async () => {
    const newArticleData = {
      title: "Article 3",
      content: "Article 3 content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    const newArticle = await findArticle(newArticleData);

    const updatedArticleData = {
      title: "Article updated",
      content: "Article updated content",
    };

    const response2 = await app.inject({
      method: "PATCH",
      url: `/articles/${newArticle.id}`,
      payload: {
        data: updatedArticleData,
      },
    });

    expect(response2.statusCode).toBe(302);

    const updatedArticle = await findArticle(updatedArticleData);
    expect(updatedArticle).not.toBeNull();
    const article = await findArticle(newArticleData);
    expect(article).toBeNull();
  });

  // Формы отправляют PATCH и DELETE как POST со скрытым полем `_method`,
  // потому что HTML умеет только GET и POST. Прямые PATCH и DELETE проверяются
  // выше, здесь проверяется именно подмена.
  test("update article - POST with _method=patch", async () => {
    const articleData = {
      title: "Article via _method",
      content: "Article via _method content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });

    const article = await findArticle(articleData);

    const updatedData = {
      title: "Article via _method updated",
      content: "Article via _method updated content",
    };

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}`,
      payload: { _method: "patch", data: updatedData },
    });

    expect(response.statusCode).toBe(302);
    expect(await findArticle(updatedData)).not.toBeNull();
  });

  test("delete article - POST with _method=delete", async () => {
    const articleData = {
      title: "Article to delete via _method",
      content: "Article to delete via _method content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });

    const article = await findArticle(articleData);

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}`,
      payload: { _method: "delete" },
    });

    expect(response.statusCode).toBe(302);
    expect(await findArticleById(article.id)).toBeNull();
  });

  // POST-маршрута на этом адресе нет: там объявлены PATCH и DELETE, а POST
  // доходит до них только через `_method`. Без него отвечает «не найдено», а не
  // «метод не разрешён»: раньше 405 отдавал разбор `_method`, написанный руками
  // в роутере, теперь его делает @hexlet/fastify-method-override.
  test("POST without _method is not found", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/articles/1",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  test("delete article - DELETE /articles/:id", async () => {
    const newArticleData = {
      title: "Article 4",
      content: "Article 4 content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    const newArticle = await findArticle(newArticleData);

    const response2 = await app.inject({
      method: "DELETE",
      url: `/articles/${newArticle.id}`,
    });

    expect(response2.statusCode).toBe(302);

    const updatedArticle = await findArticle(newArticleData);
    expect(updatedArticle).toBeNull();
  });

  test("show article - GET /articles/:id", async () => {
    const newArticleData = {
      title: "Article 5",
      content: "Article 5 content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: {
        data: newArticleData,
      },
    });

    const newArticle = await findArticle(newArticleData);

    const response2 = await app.inject({
      method: "GET",
      url: `/articles/${newArticle.id}`,
    });

    expect(response2.statusCode).toBe(200);
  });

  test("show missing article - GET /articles/:id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/articles/999999",
    });

    expect(response.statusCode).toBe(404);
  });

  test("create comment - POST and redirect to article", async () => {
    const articleData = {
      title: "Article for comments",
      content: "Article content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });
    const article = await findArticle(articleData);

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}/comments`,
      payload: {
        data: {
          authorName: "  Alice  ",
          content: "  A useful comment  ",
        },
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`/articles/${article.id}`);
    expect(await findCommentsByArticleId(article.id)).toMatchObject([
      {
        articleId: article.id,
        authorName: "Alice",
        content: "A useful comment",
      },
    ]);
  });

  test("show comments in createdAt and id order", async () => {
    const articleData = {
      title: "Article with sorted comments",
      content: "Article content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });
    const article = await findArticle(articleData);
    const sameDate = "2026-01-02T12:00:00.000Z";

    await app.db.insert(comments).values([
      {
        articleId: article.id,
        authorName: "Later",
        content: "later",
        createdAt: "2026-01-03T12:00:00.000Z",
      },
      {
        articleId: article.id,
        authorName: "First",
        content: "first",
        createdAt: "2026-01-01T12:00:00.000Z",
      },
      {
        articleId: article.id,
        authorName: "Same first",
        content: "same first",
        createdAt: sameDate,
      },
      {
        articleId: article.id,
        authorName: "Same second",
        content: "same second",
        createdAt: sameDate,
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/articles/${article.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.indexOf("First")).toBeLessThan(response.body.indexOf("Same first"));
    expect(response.body.indexOf("Same first")).toBeLessThan(response.body.indexOf("Same second"));
    expect(response.body.indexOf("Same second")).toBeLessThan(response.body.indexOf("Later"));
  });

  test("reject invalid comment and preserve trimmed values", async () => {
    const articleData = {
      title: "Article with invalid comment",
      content: "Article content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });
    const article = await findArticle(articleData);

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}/comments`,
      payload: {
        data: {
          authorName: "  A  ",
          content: "  Preserved comment  ",
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).toContain('value="A"');
    expect(response.body).toContain("Preserved comment");
    expect(response.body).toContain("Name must contain 2 to 80 characters");
    expect(await findCommentsByArticleId(article.id)).toHaveLength(0);
  });

  test("reject whitespace-only comment fields", async () => {
    const articleData = {
      title: "Article with blank comment",
      content: "Article content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });
    const article = await findArticle(articleData);

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}/comments`,
      payload: {
        data: { authorName: "   ", content: "   " },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(await findCommentsByArticleId(article.id)).toHaveLength(0);
  });

  test("escape comment text in article HTML", async () => {
    const articleData = {
      title: "Article with escaped comment",
      content: "Article content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });
    const article = await findArticle(articleData);

    await app.inject({
      method: "POST",
      url: `/articles/${article.id}/comments`,
      payload: {
        data: {
          authorName: "Alice",
          content: '<script>alert("x")</script>',
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/articles/${article.id}`,
    });

    expect(response.body).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(response.body).not.toContain('<script>alert("x")</script>');
  });

  test("delete article cascades to comments", async () => {
    const articleData = {
      title: "Article with comments to delete",
      content: "Article content",
    };

    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data: articleData },
    });
    const article = await findArticle(articleData);
    await app.db.insert(comments).values({
      articleId: article.id,
      authorName: "Alice",
      content: "Will be deleted",
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/articles/${article.id}`,
    });

    expect(response.statusCode).toBe(302);
    expect(await findCommentsByArticleId(article.id)).toHaveLength(0);
  });

  afterAll(async () => {
    await app.close();
  });
});
