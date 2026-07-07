import './Switch.css';

type SwitchProps = {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
};

export function Switch({ checked, onChange, disabled, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`ds-switch${checked ? ' ds-switch--on' : ''}`}
      onClick={onChange}
    >
      <span className="ds-switch__thumb" />
    </button>
  );
}
