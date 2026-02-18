type ClerkErrorLike = {
  errors?: Array<{
    code?: string;
    message?: string;
    longMessage?: string;
  }>;
  message?: string;
};

export type AuthUiError = {
  message: string;
  action?: 'switch-to-sign-up' | 'switch-to-sign-in';
};

function getFirstError(err: unknown) {
  const e = err as ClerkErrorLike | undefined;
  return e?.errors?.[0];
}

export function toAuthUiError(err: unknown): AuthUiError {
  const first = getFirstError(err);
  const code = first?.code;

  // Clerk error code mapping (best-effort; safe fallbacks).
  switch (code) {
    // Sign in
    case 'form_identifier_not_found':
      return {
        message: 'לא מצאנו חשבון עם כתובת האימייל הזו. רוצה להירשם?',
        action: 'switch-to-sign-up',
      };
    case 'form_password_incorrect':
      return { message: 'הסיסמה שגויה. נסה שוב.' };

    // Sign up
    case 'form_identifier_exists':
      return {
        message: 'כבר קיים חשבון עם כתובת האימייל הזו. רוצה להתחבר במקום?',
        action: 'switch-to-sign-in',
      };
    case 'form_password_pwned':
    case 'form_password_too_weak':
    case 'form_password_length_too_short':
    case 'form_password_validation_failed':
      return { message: 'הסיסמה חלשה מדי. נסה סיסמה ארוכה יותר עם אותיות ומספרים.' };

    // Email code
    case 'form_code_incorrect':
      return { message: 'קוד האימות שגוי. נסה שוב.' };
    case 'form_code_expired':
      return { message: 'קוד האימות פג תוקף. בקש קוד חדש ונסה שוב.' };

    // Rate limiting / generic
    case 'too_many_attempts':
      return { message: 'בוצעו יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.' };
    default: {
      const msg = first?.longMessage || first?.message || (err as ClerkErrorLike | undefined)?.message;
      return { message: msg ? `שגיאה: ${msg}` : 'אירעה שגיאה. נסה שוב.' };
    }
  }
}

