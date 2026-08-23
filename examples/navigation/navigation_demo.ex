defmodule ZedSurface.NavigationDemo do
  use Surface.Component

  embed_sface("navigation_demo.sface")

  prop(id, :string, default: "surface-demo")
  prop(title, :string, required: true)
  prop(rest, :map, default: %{})
  data(items, :list, default: [])

  def render(assigns), do: navigation_demo(assigns)

  slot :footer
  def card(assigns), do: assigns

  defp badge(assigns), do: assigns

  defp format_label(value), do: String.upcase(value)
end
