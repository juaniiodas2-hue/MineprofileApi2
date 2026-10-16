# MineProfile API
Autor: Juan Esteban Hernandez

API REST (Node.js + Express) para guardar perfiles de jugadores de Minecraft.
Arquitectura: API Gateway (HTTP API) -> Lambda -> DynamoDB, region us-east-1.

## Desplegar
```
sam build
sam deploy --guided   # region us-east-1, en ApiKey escribe tu clave secreta
```
La URL aparece en la salida `ApiUrl`.

## Endpoints
| Metodo | Ruta | Proteccion | Respuestas |
|---|---|---|---|
| GET | /health | - | 200 |
| POST | /api/v1/perfiles | x-api-key | 201, 400, 401 |
| GET | /api/v1/perfiles?limite=&siguiente=&favorito= | - | 200 |
| GET | /api/v1/perfiles/{id} | - | 200, 404 |
| PUT | /api/v1/perfiles/{id} | x-api-key | 200, 400, 401, 404 |
| DELETE | /api/v1/perfiles/{id} | x-api-key | 204, 401, 404 |

Cuerpo: `{"nombre":"Notch","notas":"texto","favorito":true}`

## Seguridad
HTTPS, escrituras con API key (variable de entorno), DynamoDB cifrada por defecto y con PITR, rol IAM de minimo privilegio (DynamoDBCrudPolicy sobre la tabla).
