/** Input ownership, independent of the DOM. Fingers browse; pen/mouse draw. */
export type Contact = { id: number; type: string; x: number; y: number };

export class PaperInput {
  drawing: Contact | null = null;
  readonly touches = new Map<number, Contact>();
  private readonly palms = new Set<number>();

  down(contact: Contact): "draw" | "navigate" | "ignore" {
    if (contact.type === "touch") {
      if (this.drawing || this.palms.has(contact.id)) {
        this.palms.add(contact.id);
        return "ignore";
      }
      this.touches.set(contact.id, contact);
      return "navigate";
    }
    if (this.drawing) return "ignore";
    // A Pencil landing during a pinch takes ownership immediately. Held fingers
    // stay ignored until lifted, even after the Pencil has finished its stroke.
    for (const id of this.touches.keys()) this.palms.add(id);
    this.touches.clear();
    this.drawing = contact;
    return "draw";
  }

  move(contact: Contact): "draw" | "navigate" | "ignore" {
    if (this.drawing?.id === contact.id) {
      this.drawing = contact;
      return "draw";
    }
    if (this.touches.has(contact.id)) {
      this.touches.set(contact.id, contact);
      return "navigate";
    }
    return "ignore";
  }

  up(id: number): void {
    if (this.drawing?.id === id) this.drawing = null;
    this.touches.delete(id);
    this.palms.delete(id);
  }
}
