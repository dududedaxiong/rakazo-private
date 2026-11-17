import { useLingui } from "@lingui/react/macro";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@rakazo_mickvvw/ui-web";

/** Six-digit authenticator code input; submits itself once all six digits are in. */
export function TotpCodeInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  return (
    <div className="flex justify-center">
      <InputOTP
        aria-label={t`Authenticator code`}
        maxLength={6}
        pattern="^\d+$"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        disabled={disabled}
        value={value}
        onChange={onChange}
        onComplete={onComplete}
      >
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className="size-12 text-heading3 first:rounded-l-xl last:rounded-r-xl"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}
