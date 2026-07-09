import './SlotPicker.css';

export interface Slot {
  start: string;
  end:   string;
}

type SlotPickerProps = {
  slots:    Slot[];
  value:    string | null; // start do slot selecionado
  onChange: (slot: Slot) => void;
  emptyMessage?: string;
};

/** Grade de chips de horário — o backend é quem decide o que é ofertável;
 *  aqui só se escolhe entre os slots recebidos. */
export function SlotPicker({ slots, value, onChange, emptyMessage }: SlotPickerProps) {
  if (slots.length === 0) {
    return (
      <div className="ds-slots__empty">
        {emptyMessage ?? 'Nenhum horário disponível neste dia.'}
      </div>
    );
  }

  return (
    <div className="ds-slots" role="listbox" aria-label="Horários disponíveis">
      {slots.map((slot) => (
        <button
          key={slot.start}
          type="button"
          role="option"
          aria-selected={value === slot.start}
          className={`ds-slots__chip${value === slot.start ? ' ds-slots__chip--selected' : ''}`}
          onClick={() => onChange(slot)}
        >
          {slot.start}
          <span className="ds-slots__chip-end">– {slot.end}</span>
        </button>
      ))}
    </div>
  );
}
