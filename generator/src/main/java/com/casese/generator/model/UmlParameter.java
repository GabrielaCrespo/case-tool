package com.casese.generator.model;

/** Un parámetro de una operación. Nombre y tipo son obligatorios en el modelo. */
public record UmlParameter(String id, String name, String dataType, int orderIndex) {}
