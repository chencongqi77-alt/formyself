"use client";

import { useEffect, useRef, useState } from "react";

export type PersonOption = {
  id: string;
  name: string;
  dynasty?: string | null;
};

type PersonSwitcherProps = {
  id: string;
  value: string;
  options: readonly PersonOption[];
  summary: string;
  onChange: (personId: string) => void;
  allOption?: {
    value: string;
    label: string;
  };
};

export function personOptionLabel(person: PersonOption): string {
  return person.dynasty ? `${person.name} · ${person.dynasty}` : person.name;
}

export function PersonSwitcher({
  id,
  value,
  options,
  summary,
  onChange,
  allOption,
}: PersonSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;
  const choices = [
    ...(allOption
      ? [{ key: "all", value: allOption.value, label: allOption.label }]
      : []),
    ...options.map((person) => ({
      key: `person-${person.id}`,
      value: person.id,
      label: personOptionLabel(person),
    })),
  ];
  const selectedChoice = choices.find((choice) => choice.value === value) ?? choices[0];
  const selectedIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.value === value),
  );

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [isOpen]);

  function focusOption(index: number) {
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }

  function choose(value: string) {
    onChange(value);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      focusOption(
        event.key === "ArrowDown"
          ? Math.min(selectedIndex + 1, choices.length - 1)
          : Math.max(selectedIndex - 1, 0),
      );
      return;
    }
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  function handleOptionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(Math.min(index + 1, choices.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusOption(choices.length - 1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div className="person-switcher" ref={switcherRef}>
      <label id={labelId} htmlFor={id}>人物</label>
      <div
        className="person-select"
        onBlur={(event) => {
          if (!switcherRef.current?.contains(event.relatedTarget as Node)) {
            setIsOpen(false);
          }
        }}
      >
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className="person-select-trigger"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          onClick={() => setIsOpen((open) => !open)}
          onKeyDown={handleTriggerKeyDown}
        >
          <span>{selectedChoice?.label}</span>
        </button>
        {isOpen && (
          <div
            id={listboxId}
            className="person-select-menu"
            role="listbox"
            aria-labelledby={labelId}
          >
            {choices.map((choice, index) => (
              <button
                key={choice.key}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                className={
                  "person-select-option" +
                  (choice.value === value ? " is-selected" : "")
                }
                role="option"
                aria-selected={choice.value === value}
                onClick={() => choose(choice.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span>{summary}</span>
    </div>
  );
}
