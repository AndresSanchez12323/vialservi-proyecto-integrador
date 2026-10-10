import { configure as serverlessExpress } from '@codegenie/serverless-express';
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { Handler } from 'aws-lambda';

let inicio: Promise<Handler> | undefined;

async function iniciar(): Promise<Handler> {
  // Resolver secretos ANTES de importar config/app. Nunca imprimir valores.
  const variables = ['JWT_SECRET', ...(process.env.CORREO_MODO === 'smtp' ? ['SMTP_CLAVE'] : [])];
  const prefijo = process.env.SSM_PREFIJO ?? '/vialservi';
  const resultado = await new SSMClient({}).send(new GetParametersCommand({
    Names: variables.map((nombre) => `${prefijo}/${nombre}`), WithDecryption: true,
  }));
  for (const nombre of variables) {
    const parametro = resultado.Parameters?.find((p) => p.Name === `${prefijo}/${nombre}`);
    if (!parametro?.Value) throw new Error(`Falta el parametro de configuracion ${nombre}`);
    process.env[nombre] = parametro.Value;
  }
  const { crearApp } = await import('./app.js');
  return serverlessExpress({ app: crearApp(), logSettings: { level: 'error' } });
}

export const handler: Handler = async (evento, contexto, callback) => {
  contexto.callbackWaitsForEmptyEventLoop = false;
  inicio ??= iniciar().catch((error) => { inicio = undefined; throw error; });
  const ejecutar = await inicio;
  return ejecutar(evento, contexto, callback);
};
