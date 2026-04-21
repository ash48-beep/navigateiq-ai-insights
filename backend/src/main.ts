import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: false
  });
  const configService = app.get(ConfigService);

  // Register global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Enable validation globally
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Set global prefix
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // Enable CORS
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: '*',
    exposedHeaders: [
      'Content-Type',
      'Cache-Control',
      'Connection',
      'X-Accel-Buffering',
      'Transfer-Encoding',
      'Content-Length'
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400
  });

  // Setup Swagger documentation
  const swaggerTitle = configService.get<string>('SWAGGER_TITLE', 'a Chatbot API');
  const swaggerDescription = configService.get<string>('SWAGGER_DESCRIPTION', 'API for managing chatbot conversations');
  const swaggerVersion = configService.get<string>('SWAGGER_VERSION', '1.0.0');

  const config = new DocumentBuilder()
    .setTitle(swaggerTitle)
    .setDescription(swaggerDescription)
    .setVersion(swaggerVersion)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = configService.get<number>('PORT', 3002);
  await app.listen(port);

  console.log(`Application is running !`);
}

bootstrap();