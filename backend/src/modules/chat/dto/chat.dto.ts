import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatDto {
  @ApiProperty({
    description: 'Natural language query for Snowflake data analysis',
    example: 'Who are our top 5 customers by total spend?',
    maxLength: 1000
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000, { message: 'Message cannot exceed 1000 characters' })
  message: string;

  @ApiPropertyOptional({
    description: 'Session ID to maintain conversation history across turns',
    example: 'session-1234567890-abc123'
  })
  @IsString()
  @IsOptional()
  sessionId?: string;
}
