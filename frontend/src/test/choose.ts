import { fireEvent, screen } from "@testing-library/react";

/** Pick an option from a themed <Select> (components/ui/select): open the trigger, click the option. */
export function choose(trigger: HTMLElement, option: string | RegExp) {
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: option }));
}
