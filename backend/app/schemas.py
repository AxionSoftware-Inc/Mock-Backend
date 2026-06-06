from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

FieldType = Literal["string", "number", "boolean"]
ProjectAccess = Literal["public", "private"]


class MockField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$")
    type: FieldType
    required: bool = False

    @field_validator("name")
    @classmethod
    def prevent_reserved_id(cls, value: str) -> str:
        if value == "id":
            raise ValueError("id avtomatik yaratiladi.")
        return value


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=120)
    access: ProjectAccess = "public"
    resource: str = Field(min_length=1, max_length=120)
    fields: list[MockField] = Field(min_length=1, max_length=50)

    @field_validator("fields")
    @classmethod
    def prevent_duplicate_fields(cls, fields: list[MockField]) -> list[MockField]:
        names = [field.name for field in fields]
        if len(names) != len(set(names)):
            raise ValueError("Field nomlari takrorlanmasligi kerak.")
        return fields


class ResourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    fields: list[MockField] = Field(min_length=1, max_length=50)

    @field_validator("fields")
    @classmethod
    def prevent_duplicate_fields(cls, fields: list[MockField]) -> list[MockField]:
        return ProjectCreate.prevent_duplicate_fields(fields)


class ResourceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    fields: list[MockField] = Field(min_length=1, max_length=50)

    @field_validator("fields")
    @classmethod
    def prevent_duplicate_fields(cls, fields: list[MockField]) -> list[MockField]:
        return ProjectCreate.prevent_duplicate_fields(fields)


class FlowSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    layout: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProjectSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access: ProjectAccess


class ApiMethod(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: Literal["GET", "POST", "PATCH", "DELETE"]
    enabled: bool = True


class ApiEndpoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    resource: str
    fields: list[MockField]
    methods: list[ApiMethod]
    recordCount: int


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project: str
    name: str
    access: ProjectAccess
    endpoints: list[ApiEndpoint]
