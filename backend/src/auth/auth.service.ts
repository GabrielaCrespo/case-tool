import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { Varchar } from '@prisma/orm-postgres/target/codec-types';
import bcrypt from 'bcryptjs';
import type { Models } from '../prisma/contract.d';
import { db } from '../prisma/db.js';

/** users.full_name y users.email están declarados como VARCHAR(150). */
const NAME_MAX_LENGTH = 150;
const EMAIL_MAX_LENGTH = 150;

/** users.password_hash es VARCHAR(255); bcrypt genera 60 caracteres. */
const PASSWORD_HASH_MAX_LENGTH = 255;

/** bcrypt sólo tiene en cuenta los primeros 72 bytes de la contraseña. */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;

/** Coste del hash: equilibrio habitual entre seguridad y tiempo de respuesta. */
const SALT_ROUNDS = 10;

/** Código de PostgreSQL para violación de restricción única. */
const UNIQUE_VIOLATION = '23505';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserRow = Scalars<Models.public_Users>;

/** Usuario tal como lo devuelve la API: nunca incluye password_hash. */
export interface UserResponse {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  /** CU11 — El editor enseña la configuración de la IA sólo a quien la puede cambiar. */
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

/** Respuesta de registro e inicio de sesión. */
export interface AuthResponse {
  access_token: string;
  token_type: 'Bearer';
  user: UserResponse;
}

export interface RegisterInput {
  full_name?: unknown;
  email?: unknown;
  password?: unknown;
}

export interface LoginInput {
  email?: unknown;
  password?: unknown;
}

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  /** Crea una cuenta y devuelve el token para empezar a usarla. */
  async register(data: RegisterInput): Promise<AuthResponse> {
    const fullName = this.validateFullName(data?.full_name);
    const email = this.validateEmail(data?.email);
    const password = this.validatePassword(data?.password);

    const existing = await db.orm.public.Users.select('id').where({ email }).first();
    if (existing) {
      throw new ConflictException('Ya existe una cuenta registrada con ese correo.');
    }

    let user: UserRow;
    try {
      user = await db.orm.public.Users.create({
        fullName,
        email,
        passwordHash: (await bcrypt.hash(
          password,
          SALT_ROUNDS,
        )) as Varchar<typeof PASSWORD_HASH_MAX_LENGTH>,
        avatarUrl: null,
      });
    } catch (error) {
      // Dos registros simultáneos con el mismo correo: la restricción UNIQUE
      // de la base de datos es la que decide, y se traduce a un 409.
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Ya existe una cuenta registrada con ese correo.');
      }
      throw error;
    }

    return this.buildAuthResponse(user);
  }

  /** Comprueba las credenciales y devuelve un token nuevo. */
  async login(data: LoginInput): Promise<AuthResponse> {
    const email = this.normalizeEmail(data?.email);
    const password = typeof data?.password === 'string' ? data.password : '';

    const user = email
      ? await db.orm.public.Users.where({ email: email as Varchar<typeof EMAIL_MAX_LENGTH> }).first()
      : null;

    // El mismo mensaje para correo inexistente y contraseña incorrecta: así no
    // se puede averiguar qué cuentas existen.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Correo electrónico o contraseña incorrectos.');
    }

    return this.buildAuthResponse(user);
  }

  /** Datos del usuario autenticado (GET /auth/me). */
  async findById(userId: string): Promise<UserResponse> {
    const user = await db.orm.public.Users.first({ id: userId });

    // El token es válido pero la cuenta ya no existe.
    if (!user) {
      throw new UnauthorizedException('La cuenta asociada al token ya no existe.');
    }

    return this.toUserResponse(user);
  }

  private async buildAuthResponse(user: UserRow): Promise<AuthResponse> {
    const access_token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return { access_token, token_type: 'Bearer', user: this.toUserResponse(user) };
  }

  private toUserResponse(user: UserRow): UserResponse {
    return {
      id: user.id,
      full_name: user.fullName,
      email: user.email,
      avatar_url: user.avatarUrl,
      is_admin: user.isAdmin,
      created_at: new Date(user.createdAt).toISOString(),
      updated_at: new Date(user.updatedAt).toISOString(),
    };
  }

  private validateFullName(value: unknown): Varchar<typeof NAME_MAX_LENGTH> {
    if (typeof value !== 'string') {
      throw new BadRequestException('El nombre completo es obligatorio y debe ser un texto.');
    }

    const fullName = value.trim();
    if (fullName.length === 0) {
      throw new BadRequestException('El nombre completo no puede estar vacío.');
    }
    if (fullName.length > NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `El nombre completo no puede superar los ${NAME_MAX_LENGTH} caracteres.`,
      );
    }

    return fullName as Varchar<typeof NAME_MAX_LENGTH>;
  }

  private validateEmail(value: unknown): Varchar<typeof EMAIL_MAX_LENGTH> {
    const email = this.normalizeEmail(value);

    if (!email) {
      throw new BadRequestException('El correo electrónico es obligatorio y debe ser un texto.');
    }
    if (!EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('El correo electrónico no tiene un formato válido.');
    }
    if (email.length > EMAIL_MAX_LENGTH) {
      throw new BadRequestException(
        `El correo electrónico no puede superar los ${EMAIL_MAX_LENGTH} caracteres.`,
      );
    }

    return email as Varchar<typeof EMAIL_MAX_LENGTH>;
  }

  /** El correo se guarda en minúsculas para que no haya cuentas duplicadas. */
  private normalizeEmail(value: unknown): string | null {
    return typeof value === 'string' ? value.trim().toLowerCase() : null;
  }

  private validatePassword(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('La contraseña es obligatoria y debe ser un texto.');
    }
    if (value.length < PASSWORD_MIN_LENGTH) {
      throw new BadRequestException(
        `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      );
    }
    if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) {
      throw new BadRequestException(
        `La contraseña no puede superar los ${PASSWORD_MAX_BYTES} bytes.`,
      );
    }

    return value;
  }

  private isUniqueViolation(error: unknown): boolean {
    const candidate = error as { sqlState?: unknown; cause?: { code?: unknown } } | null;

    return (
      candidate?.sqlState === UNIQUE_VIOLATION || candidate?.cause?.code === UNIQUE_VIOLATION
    );
  }
}
