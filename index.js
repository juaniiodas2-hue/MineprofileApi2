import express from 'express';
import serverless from 'serverless-http';
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, DeleteCommand
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_NAME;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const app = express();
// serverless-http + Express 5: el body llega en el evento de API Gateway, se lee de ahi
app.use((req, res, next) => {
  const ev = req.apiGateway?.event;
  if (ev && typeof ev.body === 'string' && ev.body.length) {
    try {
      const txt = ev.isBase64Encoded ? Buffer.from(ev.body, 'base64').toString('utf8') : ev.body;
      req.body = JSON.parse(txt);
    } catch {
      return falla(res, 400, 'VALIDACION', 'JSON invalido');
    }
    return next();
  }
  return express.json()(req, res, next);
});

const falla = (res, status, codigo, mensaje, detalles) =>
  res.status(status).json({ error: { codigo, mensaje, ...(detalles && { detalles }) } });

// Seguridad: las escrituras exigen la API key en la cabecera x-api-key
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      (!process.env.API_KEY || req.get('x-api-key') !== process.env.API_KEY)) {
    return falla(res, 401, 'NO_AUTORIZADO', 'API key ausente o invalida');
  }
  next();
});

// Validacion de entrada
function validar(b) {
  const e = [];
  if (typeof b.nombre !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(b.nombre))
    e.push({ campo: 'nombre', mensaje: 'Obligatorio, 3-16 caracteres (letras, numeros o _)' });
  if (b.notas !== undefined && (typeof b.notas !== 'string' || b.notas.length > 200))
    e.push({ campo: 'notas', mensaje: 'Debe ser texto de maximo 200 caracteres' });
  if (b.favorito !== undefined && typeof b.favorito !== 'boolean')
    e.push({ campo: 'favorito', mensaje: 'Debe ser true o false' });
  return e;
}
const armar = (b) => ({
  nombre: b.nombre,
  notas: b.notas ?? '',
  favorito: b.favorito ?? false,
  skinUrl: `https://mc-heads.net/body/${b.nombre}`
});

app.get('/health', (req, res) => res.status(200).json({ estado: 'ok' }));

// CREAR
app.post('/api/v1/perfiles', async (req, res) => {
  const e = validar(req.body ?? {});
  if (e.length) return falla(res, 400, 'VALIDACION', 'Datos invalidos', e);
  const ahora = new Date().toISOString();
  const item = { id: randomUUID(), ...armar(req.body), creadoEn: ahora, actualizadoEn: ahora };
  await db.send(new PutCommand({ TableName: TABLE, Item: item }));
  res.status(201).json(item);
});

// LISTAR (filtro ?favorito=true, paginacion ?limite=&siguiente=)
app.get('/api/v1/perfiles', async (req, res) => {
  const limite = Math.min(parseInt(req.query.limite) || 10, 50);
  const p = { TableName: TABLE, Limit: limite };
  if (req.query.favorito !== undefined) {
    p.FilterExpression = 'favorito = :f';
    p.ExpressionAttributeValues = { ':f': req.query.favorito === 'true' };
  }
  if (req.query.siguiente) {
    try { p.ExclusiveStartKey = JSON.parse(Buffer.from(req.query.siguiente, 'base64url').toString()); }
    catch { return falla(res, 400, 'VALIDACION', 'Parametro siguiente invalido'); }
  }
  const r = await db.send(new ScanCommand(p));
  res.status(200).json({
    items: r.Items,
    siguiente: r.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString('base64url') : null
  });
});

// CONSULTAR POR ID
app.get('/api/v1/perfiles/:id', async (req, res) => {
  const r = await db.send(new GetCommand({ TableName: TABLE, Key: { id: req.params.id } }));
  if (!r.Item) return falla(res, 404, 'NO_ENCONTRADO', 'Perfil no existe');
  res.status(200).json(r.Item);
});

// ACTUALIZAR
app.put('/api/v1/perfiles/:id', async (req, res) => {
  const e = validar(req.body ?? {});
  if (e.length) return falla(res, 400, 'VALIDACION', 'Datos invalidos', e);
  const previo = await db.send(new GetCommand({ TableName: TABLE, Key: { id: req.params.id } }));
  if (!previo.Item) return falla(res, 404, 'NO_ENCONTRADO', 'Perfil no existe');
  const item = { ...previo.Item, ...armar(req.body), actualizadoEn: new Date().toISOString() };
  await db.send(new PutCommand({ TableName: TABLE, Item: item }));
  res.status(200).json(item);
});

// ELIMINAR
app.delete('/api/v1/perfiles/:id', async (req, res) => {
  try {
    await db.send(new DeleteCommand({
      TableName: TABLE, Key: { id: req.params.id }, ConditionExpression: 'attribute_exists(id)'
    }));
    res.status(204).end();
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException')
      return falla(res, 404, 'NO_ENCONTRADO', 'Perfil no existe');
    throw err;
  }
});

app.use((req, res) => falla(res, 404, 'RUTA_NO_ENCONTRADA', 'Ruta no existe'));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return falla(res, 400, 'VALIDACION', 'JSON invalido');
  console.error(JSON.stringify({ nivel: 'error', mensaje: err.message }));
  falla(res, 500, 'ERROR_INTERNO', 'Error interno del servidor');
});

export const handler = serverless(app);
