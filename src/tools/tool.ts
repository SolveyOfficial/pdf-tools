export interface Tool {
  /** Used in the address, e.g. #merge. */
  id: string;
  /** Short name for the tab. */
  title: string;
  heading: string;
  description: string;
  mount(container: HTMLElement): void;
}
