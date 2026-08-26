export const DEFAULT_PUBLIC_MODULE_PERSON_ID = "su-shi";

type PersonWithId = {
  id: string;
};

/**
 * Public poetry modules always open on Su Shi unless the URL names a valid
 * person explicitly.
 */
export function resolvePublicModulePerson<T extends PersonWithId>(
  people: readonly T[],
  requestedPersonId: string | undefined = undefined,
): T | undefined {
  return (
    people.find((person) => person.id === requestedPersonId) ??
    people.find((person) => person.id === DEFAULT_PUBLIC_MODULE_PERSON_ID)
  );
}
