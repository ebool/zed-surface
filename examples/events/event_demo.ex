defmodule ZedSurface.EventDemo do
  use Surface.LiveView

  import ZedSurface.EventButton, only: [event_button: 1]

  embed_sface("event_demo.sface")

  def render(assigns), do: event_demo(assigns)

  def handle_event("delete", %{"confirmed" => true}, socket), do: {:noreply, socket}
  def handle_event("delete", _params, socket), do: {:noreply, socket}
end
