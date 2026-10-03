/*
 * Builds list / options / get / create / update / delete routes for one entity from a
 * config (see crud/entities.js). Mounted at /api/:scope/<path>, so the same routes serve
 * own-fleet and sub-vendor tables; services/scope.js picks the model per request.
 */
const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const env = require('../config/env');
const { modelFor } = require('../services/scope');
const { HttpError } = require('../middleware/errorHandler');
const { pdfUpload, storedPath } = require('../middleware/upload');
const { parseBody } = require('../utils/validation');
const { pageParams, pageResult } = require('../utils/pagination');
const { audit } = require('../utils/audit');

function toId(value) {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

function buildWhere(def, req, scope) {
  const where = { ...(def.list.where?.(scope) || {}) };
  const { search } = req.query;

  if (search && def.list.search?.length) {
    const term = `%${String(search).trim().slice(0, 100)}%`;
    where[Op.or] = def.list.search.map((field) => ({ [field]: { [Op.like]: term } }));
  }

  for (const [param, column] of Object.entries(def.list.filters || {})) {
    const raw = req.query[param];
    if (raw === undefined || raw === '') continue;
    const values = (Array.isArray(raw) ? raw : [raw]).map(toId);
    where[column] = values.length === 1 ? values[0] : { [Op.in]: values };
  }
  return where;
}

const includeFor = (def) => (def.list.include || []).map(({ as, attributes }) => ({ association: as, attributes }));

// Removes files saved by multer for a request that then failed.
function discardUploads(req) {
  for (const file of Object.values(req.files || {}).flat()) fs.rm(file.path, { force: true }, () => {});
}

// Adds uploaded file paths to the data; fields without a new file keep their stored value.
function withUploads(def, req, data) {
  if (!def.upload) return data;
  const out = { ...data };
  for (const field of def.upload) {
    const file = req.files?.[field]?.[0];
    if (file) out[field] = storedPath(file);
    else delete out[field];
  }
  return out;
}

function crudRouter(def) {
  const router = Router({ mergeParams: true });
  const uploadMw = def.upload ? pdfUpload(def.upload) : [];
  const ctxFor = (req, extra = {}) => ({ req, scope: req.params.scope, model: modelFor(def.entity, req.params.scope), ...extra });

  // GET /  -> { rows, total, page, pages }
  router.get('/', async (req, res) => {
    const { scope } = req.params;
    const model = modelFor(def.entity, scope);
    const where = buildWhere(def, req, scope);
    const query = { where, include: includeFor(def), order: def.list.order, distinct: true };

    if (def.list.pageSize) {
      const { page, limit, offset } = pageParams(req.query, def.list.pageSize);
      const { rows, count } = await model.findAndCountAll({ ...query, limit, offset });
      return res.json(pageResult(rows, count, page, limit));
    }
    const rows = await model.findAll(query);
    res.json(pageResult(rows, rows.length, 1, null));
  });

  // GET /options -> [{ id, label }] for dropdowns
  if (def.options) {
    router.get('/options', async (req, res) => {
      const model = modelFor(def.entity, req.params.scope);
      const rows = await model.findAll({
        where: def.options.where?.(req.params.scope) || {},
        attributes: ['id', ...def.options.attributes],
        order: def.options.order,
        raw: true,
      });
      res.json(rows.map((r) => ({ ...r, label: r[def.options.label] })));
    });
  }

  // GET /:id
  router.get('/:id', async (req, res) => {
    const model = modelFor(def.entity, req.params.scope);
    const row = await model.findByPk(toId(req.params.id), { include: includeFor(def) });
    if (!row) throw new HttpError(404, `${def.label} not found`);
    res.json(row);
  });

  // POST /
  router.post('/', ...uploadMw, async (req, res) => {
    try {
      const ctx = ctxFor(req);
      let data = parseBody(def.schema, def.fromBody ? def.fromBody(req.body) : req.body);
      data = withUploads(def, req, data);
      if (def.prepare) data = await def.prepare(data, ctx);

      const created = await sequelize.transaction(async (transaction) => {
        if (def.beforeCreate) await def.beforeCreate(data, { ...ctx, transaction });
        const record = await ctx.model.create(data, { transaction });
        if (def.afterCreate) await def.afterCreate(record, data, { ...ctx, transaction });
        return record;
      });

      audit(req, { action: 'create', scope: ctx.scope, entity: def.entity, id: created.id });
      res.status(201).json(created);
    } catch (err) {
      discardUploads(req);
      throw err;
    }
  });

  // PUT /:id
  router.put('/:id', ...uploadMw, async (req, res) => {
    try {
      const id = toId(req.params.id);
      const ctx = ctxFor(req, { id });
      let data = parseBody(def.schema, def.fromBody ? def.fromBody(req.body) : req.body);
      data = withUploads(def, req, data);
      if (def.prepare) data = await def.prepare(data, ctx);

      const updated = await sequelize.transaction(async (transaction) => {
        const record = await ctx.model.findByPk(id, { transaction });
        if (!record) throw new HttpError(404, `${def.label} not found`);
        if (def.beforeUpdate) await def.beforeUpdate(data, record, { ...ctx, transaction });
        await record.update(data, { transaction });
        return record;
      });

      audit(req, { action: 'update', scope: ctx.scope, entity: def.entity, id });
      res.json(updated);
    } catch (err) {
      discardUploads(req);
      throw err;
    }
  });

  // DELETE /:id  (hard delete, or soft delete when def.softDelete is set)
  router.delete('/:id', async (req, res) => {
    const id = toId(req.params.id);
    const { scope } = req.params;
    const model = modelFor(def.entity, scope);
    const record = await model.findByPk(id);
    if (!record) throw new HttpError(404, `${def.label} not found`);

    if (def.softDelete) await record.update(def.softDelete);
    else await record.destroy();

    audit(req, { action: def.softDelete ? 'soft-delete' : 'delete', scope, entity: def.entity, id });
    res.json({ ok: true });
  });

  if (def.extend) def.extend(router);
  return router;
}

/** Serves uploaded PDFs (login required) inline, never as HTML. */
function uploadsStatic() {
  const express = require('express');
  return express.static(path.resolve(env.uploadDir), {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });
}

module.exports = { crudRouter, uploadsStatic, toId };
