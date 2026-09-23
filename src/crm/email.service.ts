import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.getOrThrow<string>('EMAIL_USER');
    this.transporter = createTransport({
      host: config.getOrThrow<string>('EMAIL_HOST'),
      port: config.get<number>('EMAIL_PORT', 465),
      secure: true,
      auth: { user: this.from, pass: config.getOrThrow<string>('EMAIL_PASSWORD') },
    });
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      return true;
    } catch (err) {
      this.logger.error(`Failed to send mail to ${to}: ${(err as Error).message}`);
      return false;
    }
  }

  sendOtp(to: string, name: string, otp: string) {
    return this.send(
      to,
      'Reset Insignia - Sales app password',
      `<p>Dear ${name}</p><p>Your OTP for your Insignia Sales app to reset password is</p><p><strong>${otp}</strong></p><p>Use this passcode to change your login password.</p><p>Thank you.</p>`,
    );
  }

  sendCredentials(to: string, userCode: string, password: string) {
    return this.send(
      to,
      'Temporary Credentials - Sales app password',
      `<p><strong>Welcome to Insignia Sales Application</strong></p><p>Your UserCode: <strong>${userCode}</strong></p><p>Your Password: <strong>${password}</strong></p><p>Use these credentials to login to your application.</p><p>Thank you.</p>`,
    );
  }
}
