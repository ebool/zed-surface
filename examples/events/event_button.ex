defmodule ZedSurface.EventButton do
  use Phoenix.Component

  def event_button(assigns) do
    ~H"""
    <button phx-click={JS.push("delete")}>Delete from component</button>
    """
  end
end
